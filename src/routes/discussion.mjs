import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import requireAuth from '../middleware/require-auth.mjs';

const messageSchema = z.object({
    content: z.string().trim().min(1).max(5000)
}).strict();

const limitSchema = z.string().regex(/^\d+$/).optional();
const beforeSchema = z.iso.datetime({ offset: true }).optional();

function validationError(res, error) {
    return res.status(400).json({
        error: 'Invalid request',
        details: error.issues.map(({ path, message }) => ({
            field: path.join('.'),
            message
        }))
    });
}

function serializeMessage(message) {
    return {
        id: message.id,
        threadId: message.threadId,
        authorId: message.authorId,
        content: message.content,
        replyTo: message.replyTo,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
    };
}

export default function createDiscussionRouter({
    context,
    Group,
    GroupMembership,
    Event,
    EventParticipation,
    DiscussionThread,
    DiscussionMessage,
    jwtSecret
}) {
    const router = Router();
    const authenticate = requireAuth(jwtSecret);
    const isGroupDiscussion = context === 'group';
    const parentIdParam = isGroupDiscussion ? 'groupId' : 'eventId';
    const parentModel = isGroupDiscussion ? Group : Event;
    const parentField = isGroupDiscussion ? 'groupId' : 'eventId';

    if (context !== 'group' && context !== 'event') {
        throw new Error('Discussion context must be group or event');
    }

    async function loadParent(req, res, next) {
        const parentId = req.params[parentIdParam];
        if (!mongoose.isValidObjectId(parentId)) {
            return res.status(404).json({ error: `${isGroupDiscussion ? 'Group' : 'Event'} not found` });
        }
        req.discussionParent = await parentModel.findById(parentId);
        if (!req.discussionParent) {
            return res.status(404).json({ error: `${isGroupDiscussion ? 'Group' : 'Event'} not found` });
        }
        return next();
    }

    async function requireDiscussionAccess(req, res, next) {
        if (isGroupDiscussion) {
            const membership = await GroupMembership.findOne({
                groupId: req.discussionParent.id,
                userId: req.authUserId,
                status: 'active'
            });
            if (!membership) {
                return res.status(403).json({ error: 'Active group membership required' });
            }
            req.discussionRole = membership.role;
        } else {
            const participation = await EventParticipation.findOne({
                eventId: req.discussionParent.id,
                userId: req.authUserId,
                role: { $in: ['participant', 'organizer'] },
                status: 'going'
            });
            if (!participation) {
                return res.status(403).json({ error: 'Confirmed event participation required' });
            }
            req.discussionRole = participation.role;
        }
        return next();
    }

    async function ensureThread(parentId) {
        const filter = { [parentField]: parentId };
        let thread = await DiscussionThread.findOne(filter);
        if (thread) return thread;

        try {
            thread = await DiscussionThread.create(filter);
            return thread;
        } catch (error) {
            if (error.code !== 11000) throw error;
            thread = await DiscussionThread.findOne(filter);
            if (!thread) throw error;
            return thread;
        }
    }

    async function createMessage(req, res, replyTo = null) {
        const parsed = messageSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        if (isGroupDiscussion
            && req.discussionRole !== 'admin'
            && !req.discussionParent.memberCanPost) {
            return res.status(403).json({ error: 'Group members are not allowed to post' });
        }

        const thread = await ensureThread(req.discussionParent.id);
        if (replyTo) {
            const parentMessage = await DiscussionMessage.findOne({
                _id: replyTo,
                threadId: thread.id,
                replyTo: null
            });
            if (!parentMessage) {
                return res.status(404).json({ error: 'Message to reply to not found' });
            }
        }

        const message = await DiscussionMessage.create({
            threadId: thread.id,
            authorId: req.authUserId,
            content: parsed.data.content,
            replyTo
        });
        return res.status(201).json({ message: serializeMessage(message) });
    }

    const basePath = `/:${parentIdParam}/discussion/messages`;
    router.get(basePath, authenticate, loadParent, requireDiscussionAccess, async (req, res) => {
        const querySchema = z.object({
            limit: limitSchema,
            before: beforeSchema
        }).strict();
        const parsed = querySchema.safeParse(req.query);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const limit = parsed.data.limit === undefined ? 50 : Number(parsed.data.limit);
        if (limit < 1 || limit > 100) {
            return res.status(400).json({
                error: 'Invalid request',
                details: [{ field: 'limit', message: 'Limit must be between 1 and 100' }]
            });
        }

        const thread = await ensureThread(req.discussionParent.id);
        const filter = { threadId: thread.id };
        if (parsed.data.before) {
            filter.createdAt = { $lt: new Date(parsed.data.before) };
        }

        const fetchedMessages = await DiscussionMessage.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1);
        const hasMore = fetchedMessages.length > limit;
        const messages = fetchedMessages.slice(0, limit);
        return res.status(200).json({
            messages: messages.map(serializeMessage),
            hasMore,
            nextBefore: hasMore
                ? messages[messages.length - 1].createdAt
                : null
        });
    });

    router.post(basePath, authenticate, loadParent, requireDiscussionAccess, async (req, res) => {
        return createMessage(req, res);
    });

    router.post(
        `${basePath}/:messageId/replies`,
        authenticate,
        loadParent,
        requireDiscussionAccess,
        async (req, res) => {
            if (!mongoose.isValidObjectId(req.params.messageId)) {
                return res.status(404).json({ error: 'Message to reply to not found' });
            }
            return createMessage(req, res, req.params.messageId);
        }
    );

    return router;
}
