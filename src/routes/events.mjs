import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import requireAuth, { optionalAuth } from '../middleware/require-auth.mjs';

const eventFields = {
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().min(1).max(10000),
    startAt: z.iso.datetime({ offset: true }).pipe(z.coerce.date()),
    endAt: z.iso.datetime({ offset: true }).pipe(z.coerce.date()),
    place: z.string().trim().min(1).max(500),
    coverUrl: z.string().url().nullable().optional(),
    visibility: z.enum(['public', 'private'])
};

const createEventSchema = z.object({
    ...eventFields,
    groupId: z.string().refine((value) => mongoose.isValidObjectId(value)).nullable().optional()
}).strict().refine((data) => data.endAt > data.startAt, {
    path: ['endAt'],
    message: 'End date must be after start date'
});

const updateEventSchema = z.object({
    name: eventFields.name.optional(),
    description: eventFields.description.optional(),
    startAt: eventFields.startAt.optional(),
    endAt: eventFields.endAt.optional(),
    place: eventFields.place.optional(),
    coverUrl: eventFields.coverUrl,
    visibility: eventFields.visibility.optional()
}).strict().refine((data) => Object.keys(data).length > 0);

const userIdSchema = z.object({
    userId: z.string().refine((value) => mongoose.isValidObjectId(value))
}).strict();

const responseSchema = z.object({
    status: z.enum(['interested', 'going', 'declined'])
}).strict();

const roleSchema = z.object({
    role: z.enum(['participant', 'organizer'])
}).strict();

function validationError(res, error) {
    return res.status(400).json({
        error: 'Invalid request',
        details: error.issues.map(({ path, message }) => ({
            field: path.join('.'),
            message
        }))
    });
}

function serializeEvent(event) {
    return {
        id: event.id,
        name: event.name,
        description: event.description,
        startAt: event.startAt,
        endAt: event.endAt,
        place: event.place,
        coverUrl: event.coverUrl,
        visibility: event.visibility,
        createdBy: event.createdBy,
        groupId: event.groupId,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt
    };
}

function serializeParticipation(participation) {
    return {
        eventId: participation.eventId,
        userId: participation.userId,
        role: participation.role,
        status: participation.status,
        respondedAt: participation.respondedAt
    };
}

export default function createEventsRouter({
    Event,
    EventParticipation,
    Group,
    GroupMembership,
    User,
    EventTicketType,
    EventTicket,
    jwtSecret
}) {
    const router = Router();
    const authenticate = requireAuth(jwtSecret);
    const optionallyAuthenticate = optionalAuth(jwtSecret);

    async function loadEvent(req, res, next) {
        if (!mongoose.isValidObjectId(req.params.eventId)) {
            return res.status(404).json({ error: 'Event not found' });
        }
        req.event = await Event.findById(req.params.eventId);
        if (!req.event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        return next();
    }

    async function activeOrganizer(eventId, userId) {
        return EventParticipation.findOne({
            eventId,
            userId,
            role: 'organizer',
            status: 'going'
        });
    }

    async function requireOrganizer(req, res, next) {
        const organizer = await activeOrganizer(req.event.id, req.authUserId);
        if (!organizer) {
            return res.status(403).json({ error: 'Event organizer permission required' });
        }
        req.organizerParticipation = organizer;
        return next();
    }

    router.get('/', optionallyAuthenticate, async (req, res) => {
        const events = await Event.find({ visibility: 'public' })
            .sort({ startAt: 1 });
        let privateEvents = [];

        if (req.authUserId) {
            const participations = await EventParticipation.find({
                userId: req.authUserId,
                status: { $in: ['invited', 'interested', 'going'] }
            }).select('eventId');
            const privateEventIds = participations.map(({ eventId }) => eventId);
            privateEvents = await Event.find({
                _id: { $in: privateEventIds },
                visibility: 'private'
            }).sort({ startAt: 1 });
        }

        const eventById = new Map([...events, ...privateEvents].map((event) => [event.id, event]));
        return res.status(200).json({
            events: [...eventById.values()].map(serializeEvent)
        });
    });

    router.post('/', authenticate, async (req, res) => {
        const parsed = createEventSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const { groupId, ...eventData } = parsed.data;
        let group = null;

        if (groupId) {
            group = await Group.findById(groupId);
            if (!group) {
                return res.status(404).json({ error: 'Group not found' });
            }

            const groupMembership = await GroupMembership.findOne({
                groupId: group.id,
                userId: req.authUserId,
                status: 'active'
            });
            if (!groupMembership) {
                return res.status(403).json({ error: 'Active group membership required to create a group event' });
            }
            if (groupMembership.role !== 'admin' && !group.memberCanCreateEvents) {
                return res.status(403).json({ error: 'Group members are not allowed to create events' });
            }
        }

        const event = await Event.create({
            ...eventData,
            coverUrl: eventData.coverUrl ?? null,
            createdBy: req.authUserId,
            groupId: group?.id ?? null
        });

        try {
            await EventParticipation.create({
                eventId: event.id,
                userId: req.authUserId,
                role: 'organizer',
                status: 'going',
                respondedAt: new Date()
            });

            if (group) {
                const memberships = await GroupMembership.find({
                    groupId: group.id,
                    status: 'active',
                    userId: { $ne: req.authUserId }
                }).select('userId');

                if (memberships.length > 0) {
                    await EventParticipation.insertMany(memberships.map(({ userId }) => ({
                        eventId: event.id,
                        userId,
                        role: 'participant',
                        status: 'invited'
                    })));
                }
            }
        } catch (error) {
            try {
                await EventParticipation.deleteMany({ eventId: event.id });
                await Event.deleteOne({ _id: event.id });
            } catch (cleanupError) {
                console.error('[ERROR] event creation cleanup failed', cleanupError);
            }
            throw error;
        }

        return res.status(201).json({ event: serializeEvent(event) });
    });

    router.get('/:eventId', optionallyAuthenticate, loadEvent, async (req, res) => {
        if (req.event.visibility === 'private') {
            const participation = req.authUserId
                ? await EventParticipation.findOne({
                    eventId: req.event.id,
                    userId: req.authUserId,
                    status: { $in: ['invited', 'interested', 'going'] }
                })
                : null;
            if (!participation) {
                return res.status(404).json({ error: 'Event not found' });
            }
        }

        return res.status(200).json({ event: serializeEvent(req.event) });
    });

    router.patch('/:eventId', authenticate, loadEvent, requireOrganizer, async (req, res) => {
        const parsed = updateEventSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const startAt = parsed.data.startAt ?? req.event.startAt;
        const endAt = parsed.data.endAt ?? req.event.endAt;
        if (endAt <= startAt) {
            return res.status(400).json({
                error: 'Invalid request',
                details: [{ field: 'endAt', message: 'End date must be after start date' }]
            });
        }

        Object.assign(req.event, parsed.data);
        await req.event.save();
        return res.status(200).json({ event: serializeEvent(req.event) });
    });

    router.delete('/:eventId', authenticate, loadEvent, requireOrganizer, async (req, res) => {
        await EventParticipation.deleteMany({ eventId: req.event.id });
        await EventTicket.deleteMany({ eventId: req.event.id });
        await EventTicketType.deleteMany({ eventId: req.event.id });
        await req.event.deleteOne();
        return res.status(204).end();
    });

    router.post('/:eventId/response', authenticate, loadEvent, async (req, res) => {
        const parsed = responseSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const existing = await EventParticipation.findOne({
            eventId: req.event.id,
            userId: req.authUserId
        });
        if (req.event.visibility === 'private' && (!existing || existing.status === 'declined')) {
            return res.status(404).json({ error: 'Event invitation not found' });
        }
        if (existing?.role === 'organizer') {
            return res.status(409).json({ error: 'Organizers cannot change their role through an RSVP' });
        }

        const respondedAt = new Date();
        const participation = existing
            ? await EventParticipation.findOneAndUpdate(
                { eventId: req.event.id, userId: req.authUserId },
                { $set: { status: parsed.data.status, respondedAt } },
                { new: true }
            )
            : await EventParticipation.create({
                eventId: req.event.id,
                userId: req.authUserId,
                role: 'participant',
                status: parsed.data.status,
                respondedAt
            });
        return res.status(200).json({ participation: serializeParticipation(participation) });
    });

    router.post('/:eventId/invitations', authenticate, loadEvent, requireOrganizer, async (req, res) => {
        const parsed = userIdSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }
        if (parsed.data.userId === req.authUserId) {
            return res.status(400).json({ error: 'You cannot invite yourself' });
        }
        const user = await User.findById(parsed.data.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        try {
            const declinedParticipation = await EventParticipation.findOneAndUpdate(
                {
                    eventId: req.event.id,
                    userId: parsed.data.userId,
                    role: 'participant',
                    status: 'declined'
                },
                { $set: { status: 'invited', respondedAt: null } },
                { new: true }
            );
            const participation = declinedParticipation || await EventParticipation.create({
                eventId: req.event.id,
                userId: parsed.data.userId,
                role: 'participant',
                status: 'invited'
            });
            return res.status(201).json({ participation: serializeParticipation(participation) });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(409).json({ error: 'User already has an event participation' });
            }
            throw error;
        }
    });

    router.get('/:eventId/participants', authenticate, loadEvent, async (req, res) => {
        const canView = req.event.visibility === 'public'
            || Boolean(await EventParticipation.findOne({
                eventId: req.event.id,
                userId: req.authUserId,
                status: { $in: ['invited', 'interested', 'going'] }
            }));
        if (!canView) {
            return res.status(404).json({ error: 'Event not found' });
        }

        const participations = await EventParticipation.find({
            eventId: req.event.id,
            status: { $in: ['interested', 'going'] }
        }).select('userId role status respondedAt');
        return res.status(200).json({
            participants: participations.map((participation) => ({
                userId: participation.userId,
                role: participation.role,
                status: participation.status,
                respondedAt: participation.respondedAt
            }))
        });
    });

    router.patch('/:eventId/participants/:userId/role', authenticate, loadEvent, requireOrganizer, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }
        const parsed = roleSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const participation = await EventParticipation.findOne({
            eventId: req.event.id,
            userId: req.params.userId,
            status: { $in: ['interested', 'going'] }
        });
        if (!participation) {
            return res.status(404).json({ error: 'Active event participation not found' });
        }

        if (participation.role === 'organizer' && parsed.data.role === 'participant') {
            const organizerCount = await EventParticipation.countDocuments({
                eventId: req.event.id,
                role: 'organizer',
                status: 'going'
            });
            if (organizerCount <= 1) {
                return res.status(409).json({ error: 'An event must always have at least one organizer' });
            }
        }

        participation.role = parsed.data.role;
        if (parsed.data.role === 'organizer') {
            participation.status = 'going';
            participation.respondedAt = new Date();
        }
        await participation.save();
        return res.status(200).json({ participation: serializeParticipation(participation) });
    });

    router.delete('/:eventId/participants/:userId', authenticate, loadEvent, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        const isSelf = req.params.userId === req.authUserId;
        if (!isSelf && !(await activeOrganizer(req.event.id, req.authUserId))) {
            return res.status(403).json({ error: 'Event organizer permission required' });
        }

        const participation = await EventParticipation.findOne({
            eventId: req.event.id,
            userId: req.params.userId,
            status: { $in: ['invited', 'interested', 'going'] }
        });
        if (!participation) {
            return res.status(404).json({ error: 'Event participation not found' });
        }
        if (participation.role === 'organizer') {
            const organizerCount = await EventParticipation.countDocuments({
                eventId: req.event.id,
                role: 'organizer',
                status: 'going'
            });
            if (organizerCount <= 1) {
                return res.status(409).json({ error: 'An event must always have at least one organizer' });
            }
        }

        await participation.deleteOne();
        return res.status(204).end();
    });

    return router;
}
