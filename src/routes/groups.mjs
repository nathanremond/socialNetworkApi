import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import requireAuth, { optionalAuth } from '../middleware/require-auth.mjs';

const groupFields = {
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(5000),
    iconUrl: z.string().url().nullable().optional(),
    coverUrl: z.string().url().nullable().optional(),
    visibility: z.enum(['public', 'private', 'secret']),
    memberCanPost: z.boolean().optional(),
    memberCanCreateEvents: z.boolean().optional()
};

const createGroupSchema = z.object(groupFields).strict();
const updateGroupSchema = z.object({
    name: groupFields.name.optional(),
    description: groupFields.description.optional(),
    iconUrl: groupFields.iconUrl,
    coverUrl: groupFields.coverUrl,
    visibility: groupFields.visibility.optional(),
    memberCanPost: groupFields.memberCanPost,
    memberCanCreateEvents: groupFields.memberCanCreateEvents
}).strict().refine((data) => Object.keys(data).length > 0);

const userIdSchema = z.object({
    userId: z.string().refine((value) => mongoose.isValidObjectId(value))
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

function serializeGroup(group) {
    return {
        id: group.id,
        name: group.name,
        description: group.description,
        iconUrl: group.iconUrl,
        coverUrl: group.coverUrl,
        visibility: group.visibility,
        memberCanPost: group.memberCanPost,
        memberCanCreateEvents: group.memberCanCreateEvents,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
    };
}

function isDuplicateKey(error) {
    return error.code === 11000;
}

export default function createGroupsRouter({ Group, GroupMembership, User, jwtSecret }) {
    const router = Router();
    const authenticate = requireAuth(jwtSecret);
    const optionallyAuthenticate = optionalAuth(jwtSecret);

    async function loadGroup(req, res, next) {
        if (!mongoose.isValidObjectId(req.params.groupId)) {
            return res.status(404).json({ error: 'Group not found' });
        }

        req.group = await Group.findById(req.params.groupId);
        if (!req.group) {
            return res.status(404).json({ error: 'Group not found' });
        }
        return next();
    }

    async function requireAdmin(req, res, next) {
        const membership = await GroupMembership.findOne({
            groupId: req.group.id,
            userId: req.authUserId,
            status: 'active',
            role: 'admin'
        });

        if (!membership) {
            return res.status(403).json({ error: 'Group administrator permission required' });
        }
        req.adminMembership = membership;
        return next();
    }

    async function activeMembership(groupId, userId) {
        return GroupMembership.findOne({ groupId, userId, status: 'active' });
    }

    router.get('/', async (req, res) => {
        const groups = await Group.find({ visibility: { $in: ['public', 'private'] } })
            .select('name description iconUrl coverUrl visibility createdAt');
        return res.status(200).json({
            groups: groups.map((group) => group.visibility === 'private'
                ? {
                    id: group.id,
                    name: group.name,
                    iconUrl: group.iconUrl,
                    visibility: group.visibility
                }
                : {
                    id: group.id,
                    name: group.name,
                    description: group.description,
                    iconUrl: group.iconUrl,
                    coverUrl: group.coverUrl,
                    visibility: group.visibility,
                    createdAt: group.createdAt
                })
        });
    });

    router.post('/', authenticate, async (req, res) => {
        const parsed = createGroupSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const group = await Group.create({
            ...parsed.data,
            createdBy: req.authUserId
        });

        try {
            await GroupMembership.create({
                groupId: group.id,
                userId: req.authUserId,
                role: 'admin',
                status: 'active',
                joinedAt: new Date()
            });
        } catch (error) {
            try {
                await Group.deleteOne({ _id: group.id });
            } catch (cleanupError) {
                console.error('[ERROR] group creation cleanup failed', cleanupError);
            }
            throw error;
        }

        return res.status(201).json({ group: serializeGroup(group) });
    });

    router.get('/:groupId', optionallyAuthenticate, loadGroup, async (req, res) => {
        if (req.group.visibility === 'secret') {
            const membership = await activeMembership(req.group.id, req.authUserId);
            if (!membership) {
                return res.status(404).json({ error: 'Group not found' });
            }
        }

        if (req.group.visibility === 'private') {
            const membership = req.authUserId
                ? await activeMembership(req.group.id, req.authUserId)
                : null;
            if (!membership) {
                return res.status(200).json({
                    group: {
                        id: req.group.id,
                        name: req.group.name,
                        iconUrl: req.group.iconUrl,
                        visibility: req.group.visibility
                    }
                });
            }
        }

        return res.status(200).json({ group: serializeGroup(req.group) });
    });

    router.patch('/:groupId', authenticate, loadGroup, requireAdmin, async (req, res) => {
        const parsed = updateGroupSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        Object.assign(req.group, parsed.data);
        await req.group.save();
        return res.status(200).json({ group: serializeGroup(req.group) });
    });

    router.delete('/:groupId', authenticate, loadGroup, requireAdmin, async (req, res) => {
        await GroupMembership.deleteMany({ groupId: req.group.id });
        await req.group.deleteOne();
        return res.status(204).end();
    });

    router.post('/:groupId/membership', authenticate, loadGroup, async (req, res) => {
        const existing = await GroupMembership.findOne({
            groupId: req.group.id,
            userId: req.authUserId
        });
        if (existing?.status === 'rejected') {
            await existing.deleteOne();
        } else if (existing) {
            return res.status(409).json({ error: 'Membership already exists', status: existing.status });
        }

        if (req.group.visibility === 'secret') {
            return res.status(403).json({ error: 'Secret groups can only be joined by invitation' });
        }

        const status = req.group.visibility === 'public' ? 'active' : 'pending';
        try {
            const membership = await GroupMembership.create({
                groupId: req.group.id,
                userId: req.authUserId,
                role: 'member',
                status,
                joinedAt: status === 'active' ? new Date() : null
            });
            return res.status(status === 'active' ? 201 : 202).json({
                membership: {
                    groupId: membership.groupId,
                    status: membership.status,
                    role: membership.role
                }
            });
        } catch (error) {
            if (isDuplicateKey(error)) {
                return res.status(409).json({ error: 'Membership already exists' });
            }
            throw error;
        }
    });

    router.post('/:groupId/invitations', authenticate, loadGroup, requireAdmin, async (req, res) => {
        const parsed = userIdSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }
        if (parsed.data.userId === req.authUserId) {
            return res.status(400).json({ error: 'You cannot invite yourself' });
        }

        const invitedUser = await User.findById(parsed.data.userId);
        if (!invitedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        try {
            const rejectedMembership = await GroupMembership.findOneAndUpdate(
                {
                    groupId: req.group.id,
                    userId: parsed.data.userId,
                    status: 'rejected'
                },
                { $set: { role: 'member', status: 'invited', joinedAt: null } },
                { new: true }
            );
            const membership = rejectedMembership || await GroupMembership.create({
                groupId: req.group.id,
                userId: parsed.data.userId,
                role: 'member',
                status: 'invited'
            });
            return res.status(201).json({
                membership: {
                    groupId: membership.groupId,
                    userId: membership.userId,
                    status: membership.status
                }
            });
        } catch (error) {
            if (isDuplicateKey(error)) {
                return res.status(409).json({ error: 'User already has a membership or invitation' });
            }
            throw error;
        }
    });

    router.post('/:groupId/invitations/accept', authenticate, loadGroup, async (req, res) => {
        const membership = await GroupMembership.findOneAndUpdate(
            {
                groupId: req.group.id,
                userId: req.authUserId,
                status: 'invited'
            },
            { $set: { status: 'active', joinedAt: new Date() } },
            { new: true }
        );

        if (!membership) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        return res.status(200).json({
            membership: {
                groupId: membership.groupId,
                status: membership.status,
                role: membership.role
            }
        });
    });

    router.post('/:groupId/invitations/decline', authenticate, loadGroup, async (req, res) => {
        const membership = await GroupMembership.findOneAndUpdate(
            {
                groupId: req.group.id,
                userId: req.authUserId,
                status: 'invited'
            },
            { $set: { status: 'rejected' } },
            { new: true }
        );
        if (!membership) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        return res.status(200).json({ membership: { status: membership.status } });
    });

    router.post('/:groupId/members/:userId/approve', authenticate, loadGroup, requireAdmin, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        const membership = await GroupMembership.findOneAndUpdate(
            {
                groupId: req.group.id,
                userId: req.params.userId,
                status: 'pending'
            },
            { $set: { status: 'active', joinedAt: new Date() } },
            { new: true }
        );
        if (!membership) {
            return res.status(404).json({ error: 'Join request not found' });
        }
        return res.status(200).json({
            membership: {
                groupId: membership.groupId,
                userId: membership.userId,
                status: membership.status
            }
        });
    });

    router.post('/:groupId/members/:userId/reject', authenticate, loadGroup, requireAdmin, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        const membership = await GroupMembership.findOneAndUpdate(
            {
                groupId: req.group.id,
                userId: req.params.userId,
                status: 'pending'
            },
            { $set: { status: 'rejected' } },
            { new: true }
        );
        if (!membership) {
            return res.status(404).json({ error: 'Join request not found' });
        }
        return res.status(200).json({
            membership: {
                groupId: membership.groupId,
                userId: membership.userId,
                status: membership.status
            }
        });
    });

    router.patch('/:groupId/members/:userId/role', authenticate, loadGroup, requireAdmin, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }
        const parsed = z.object({ role: z.enum(['member', 'admin']) }).strict().safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const membership = await GroupMembership.findOne({
            groupId: req.group.id,
            userId: req.params.userId,
            status: 'active'
        });
        if (!membership) {
            return res.status(404).json({ error: 'Active membership not found' });
        }
        if (membership.role === 'admin' && parsed.data.role === 'member') {
            const adminCount = await GroupMembership.countDocuments({
                groupId: req.group.id,
                role: 'admin',
                status: 'active'
            });
            if (adminCount <= 1) {
                return res.status(409).json({ error: 'A group must always have at least one administrator' });
            }
        }

        membership.role = parsed.data.role;
        await membership.save();
        return res.status(200).json({
            membership: {
                groupId: membership.groupId,
                userId: membership.userId,
                role: membership.role,
                status: membership.status
            }
        });
    });

    router.delete('/:groupId/members/:userId', authenticate, loadGroup, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        const isSelf = req.params.userId === req.authUserId;
        if (!isSelf) {
            const admin = await GroupMembership.findOne({
                groupId: req.group.id,
                userId: req.authUserId,
                status: 'active',
                role: 'admin'
            });
            if (!admin) {
                return res.status(403).json({ error: 'Group administrator permission required' });
            }
        }

        const membership = await GroupMembership.findOne({
            groupId: req.group.id,
            userId: req.params.userId,
            status: 'active'
        });
        if (!membership) {
            return res.status(404).json({ error: 'Active membership not found' });
        }
        if (membership.role === 'admin') {
            const adminCount = await GroupMembership.countDocuments({
                groupId: req.group.id,
                role: 'admin',
                status: 'active'
            });
            if (adminCount <= 1) {
                return res.status(409).json({ error: 'A group must always have at least one administrator' });
            }
        }

        await membership.deleteOne();
        return res.status(204).end();
    });

    router.get('/:groupId/members', authenticate, loadGroup, async (req, res) => {
        const membership = await activeMembership(req.group.id, req.authUserId);
        if (!membership) {
            return res.status(403).json({ error: 'Active group membership required' });
        }

        const members = await GroupMembership.find({ groupId: req.group.id, status: 'active' })
            .select('userId role status joinedAt');
        return res.status(200).json({
            members: members.map((member) => ({
                userId: member.userId,
                role: member.role,
                joinedAt: member.joinedAt
            }))
        });
    });

    router.get('/:groupId/membership-requests', authenticate, loadGroup, requireAdmin, async (req, res) => {
        const requests = await GroupMembership.find({
            groupId: req.group.id,
            status: 'pending'
        }).select('userId createdAt');

        return res.status(200).json({
            requests: requests.map((request) => ({
                userId: request.userId,
                requestedAt: request.createdAt
            }))
        });
    });

    router.post('/:groupId/membership/leave', authenticate, loadGroup, async (req, res) => {
        const membership = await GroupMembership.findOne({
            groupId: req.group.id,
            userId: req.authUserId,
            status: 'active'
        });
        if (!membership) {
            return res.status(404).json({ error: 'Active membership not found' });
        }
        if (membership.role === 'admin') {
            const adminCount = await GroupMembership.countDocuments({
                groupId: req.group.id,
                role: 'admin',
                status: 'active'
            });
            if (adminCount <= 1) {
                return res.status(409).json({ error: 'A group must always have at least one administrator' });
            }
        }

        await membership.deleteOne();
        return res.status(204).end();
    });

    return router;
}
