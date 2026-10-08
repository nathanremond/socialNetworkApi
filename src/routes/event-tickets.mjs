import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import requireAuth from '../middleware/require-auth.mjs';

const createTicketTypeSchema = z.object({
    name: z.string().trim().min(1).max(120),
    priceCents: z.number().int().safe().min(0),
    quantity: z.number().int().safe().min(1)
}).strict();

const updateTicketTypeSchema = createTicketTypeSchema.partial()
    .refine((data) => Object.keys(data).length > 0);

const purchaseSchema = z.object({
    ticketTypeId: z.string().refine((value) => mongoose.isValidObjectId(value)),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().max(254).pipe(z.email()),
    fullAddress: z.string().trim().min(1).max(500)
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

function serializeTicketType(ticketType) {
    return {
        id: ticketType.id,
        eventId: ticketType.eventId,
        name: ticketType.name,
        priceCents: ticketType.priceCents,
        currency: ticketType.currency,
        quantity: ticketType.quantity,
        sold: ticketType.sold,
        available: ticketType.quantity - ticketType.sold,
        createdAt: ticketType.createdAt,
        updatedAt: ticketType.updatedAt
    };
}

function serializeTicket(ticket) {
    return {
        id: ticket.id,
        eventId: ticket.eventId,
        ticketTypeId: ticket.ticketTypeId,
        ticketTypeName: ticket.ticketTypeName,
        priceCents: ticket.priceCents,
        currency: ticket.currency,
        buyer: ticket.buyer,
        purchasedAt: ticket.purchasedAt,
        paymentStatus: ticket.paymentStatus
    };
}

export default function createEventTicketsRouter({
    Event,
    EventParticipation,
    EventTicketType,
    EventTicket,
    jwtSecret
}) {
    const router = Router();
    const authenticate = requireAuth(jwtSecret);

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

    async function requireOrganizer(req, res, next) {
        const organizer = await EventParticipation.findOne({
            eventId: req.event.id,
            userId: req.authUserId,
            role: 'organizer',
            status: 'going'
        });
        if (!organizer) {
            return res.status(403).json({ error: 'Event organizer permission required' });
        }
        return next();
    }

    async function loadTicketType(req, res, next) {
        if (!mongoose.isValidObjectId(req.params.ticketTypeId)) {
            return res.status(404).json({ error: 'Ticket type not found' });
        }
        req.ticketType = await EventTicketType.findOne({
            _id: req.params.ticketTypeId,
            eventId: req.event.id
        });
        if (!req.ticketType) {
            return res.status(404).json({ error: 'Ticket type not found' });
        }
        return next();
    }

    async function restoreInventory(ticketTypeId) {
        const restored = await EventTicketType.updateOne(
            { _id: ticketTypeId, sold: { $gt: 0 } },
            { $inc: { sold: -1 } }
        );
        if (restored.modifiedCount !== 1) {
            throw new Error('Could not restore ticket inventory after a failed purchase');
        }
    }

    router.get('/:eventId/ticket-types', loadEvent, async (req, res) => {
        if (req.event.visibility !== 'public') {
            return res.status(404).json({ error: 'Ticket types not found' });
        }
        const ticketTypes = await EventTicketType.find({ eventId: req.event.id })
            .sort({ createdAt: 1 });
        return res.status(200).json({ ticketTypes: ticketTypes.map(serializeTicketType) });
    });

    router.post(
        '/:eventId/ticket-types',
        authenticate,
        loadEvent,
        requireOrganizer,
        async (req, res) => {
            if (req.event.visibility !== 'public') {
                return res.status(409).json({ error: 'Ticketing is only available for public events' });
            }
            const parsed = createTicketTypeSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }

            const ticketType = await EventTicketType.create({
                eventId: req.event.id,
                ...parsed.data,
                currency: 'EUR',
                sold: 0
            });
            return res.status(201).json({ ticketType: serializeTicketType(ticketType) });
        }
    );

    router.patch(
        '/:eventId/ticket-types/:ticketTypeId',
        authenticate,
        loadEvent,
        requireOrganizer,
        loadTicketType,
        async (req, res) => {
            const parsed = updateTicketTypeSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }
            if (parsed.data.quantity !== undefined && parsed.data.quantity < req.ticketType.sold) {
                return res.status(409).json({ error: 'Quantity cannot be lower than tickets already sold' });
            }

            Object.assign(req.ticketType, parsed.data);
            await req.ticketType.save();
            return res.status(200).json({ ticketType: serializeTicketType(req.ticketType) });
        }
    );

    router.delete(
        '/:eventId/ticket-types/:ticketTypeId',
        authenticate,
        loadEvent,
        requireOrganizer,
        loadTicketType,
        async (req, res) => {
            const deletedTicketType = await EventTicketType.findOneAndDelete({
                _id: req.ticketType.id,
                eventId: req.event.id,
                sold: 0
            });
            if (!deletedTicketType) {
                return res.status(409).json({ error: 'Ticket type cannot be deleted after tickets have been purchased' });
            }
            return res.status(204).end();
        }
    );

    router.post('/:eventId/tickets', loadEvent, async (req, res) => {
        if (req.event.visibility !== 'public') {
            return res.status(404).json({ error: 'Ticket sales are not available for this event' });
        }
        const parsed = purchaseSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const ticketType = await EventTicketType.findOne({
            _id: parsed.data.ticketTypeId,
            eventId: req.event.id
        });
        if (!ticketType) {
            return res.status(404).json({ error: 'Ticket type not found' });
        }

        const email = parsed.data.email.toLowerCase();
        const existingTicket = await EventTicket.findOne({
            eventId: req.event.id,
            'buyer.email': email
        });
        if (existingTicket) {
            return res.status(409).json({ error: 'One ticket per person is allowed for this event' });
        }

        const updatedTicketType = await EventTicketType.findOneAndUpdate(
            {
                _id: ticketType.id,
                eventId: req.event.id,
                $expr: { $lt: ['$sold', '$quantity'] }
            },
            { $inc: { sold: 1 } },
            { new: true }
        );
        if (!updatedTicketType) {
            return res.status(409).json({ error: 'No tickets of this type are available' });
        }

        try {
            const ticket = await EventTicket.create({
                eventId: req.event.id,
                ticketTypeId: updatedTicketType.id,
                ticketTypeName: updatedTicketType.name,
                priceCents: updatedTicketType.priceCents,
                currency: updatedTicketType.currency,
                buyer: {
                    firstName: parsed.data.firstName,
                    lastName: parsed.data.lastName,
                    email,
                    fullAddress: parsed.data.fullAddress
                },
                purchasedAt: new Date(),
                paymentStatus: 'not_integrated'
            });
            return res.status(201).json({ ticket: serializeTicket(ticket) });
        } catch (error) {
            try {
                await restoreInventory(updatedTicketType.id);
            } catch (restoreError) {
                console.error('[ERROR] ticket purchase inventory rollback failed', restoreError);
                throw restoreError;
            }

            if (error.code === 11000) {
                return res.status(409).json({ error: 'One ticket per person is allowed for this event' });
            }
            throw error;
        }
    });

    router.get(
        '/:eventId/tickets',
        authenticate,
        loadEvent,
        requireOrganizer,
        async (req, res) => {
            const tickets = await EventTicket.find({ eventId: req.event.id })
                .sort({ purchasedAt: -1 });
            return res.status(200).json({ tickets: tickets.map(serializeTicket) });
        }
    );

    return router;
}
