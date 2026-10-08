import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';
import jwt from 'jsonwebtoken';

import createGroupsRouter from '../src/routes/groups.mjs';

const jwtSecret = 'test-secret-that-is-long-enough-for-the-api';
const adminId = '111111111111111111111111';
const memberId = '222222222222222222222222';
const inviteeId = '333333333333333333333333';
const privateGroupId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const secretGroupId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function tokenFor(userId) {
    return jwt.sign({}, jwtSecret, {
        subject: userId,
        expiresIn: '1h',
        issuer: 'social-network-api',
        audience: 'social-network-api'
    });
}

function matches(document, query) {
    return Object.entries(query).every(([key, value]) => document[key] === value);
}

function createModels() {
    const groups = new Map();
    const memberships = new Map();
    let nextGroupId = 'cccccccccccccccccccccccc';

    function membershipKey(groupId, userId) {
        return `${groupId}:${userId}`;
    }

    function createMembership(data) {
        const key = membershipKey(data.groupId, data.userId);
        if (memberships.has(key)) {
            const error = new Error('Duplicate membership');
            error.code = 11000;
            throw error;
        }
        const membership = {
            joinedAt: null,
            ...data,
            async save() {
                memberships.set(key, this);
            },
            async deleteOne() {
                memberships.delete(key);
            }
        };
        memberships.set(key, membership);
        return membership;
    }

    class Group {
        static async create(data) {
            const id = nextGroupId;
            nextGroupId = 'dddddddddddddddddddddddd';
            const group = {
                id,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
                async save() {
                    groups.set(this.id, this);
                },
                async deleteOne() {
                    groups.delete(this.id);
                }
            };
            groups.set(id, group);
            return group;
        }

        static async findById(id) {
            return groups.get(String(id)) || null;
        }

        static find(query) {
            return {
                select: async () => [...groups.values()].filter((group) =>
                    query.visibility.$in.includes(group.visibility)
                )
            };
        }

        static async deleteOne({ _id }) {
            groups.delete(String(_id));
        }
    }

    class GroupMembership {
        static async create(data) {
            return createMembership(data);
        }

        static async findOne(query) {
            return [...memberships.values()].find((membership) => matches(membership, query)) || null;
        }

        static async findOneAndUpdate(query, update) {
            const membership = [...memberships.values()].find((candidate) => matches(candidate, query));
            if (!membership) return null;
            Object.assign(membership, update.$set);
            return membership;
        }

        static async countDocuments(query) {
            return [...memberships.values()].filter((membership) => matches(membership, query)).length;
        }

        static find(query) {
            return {
                select: async () => [...memberships.values()].filter((membership) =>
                    matches(membership, query)
                )
            };
        }

        static async deleteMany({ groupId }) {
            for (const [key, membership] of memberships) {
                if (membership.groupId === groupId) memberships.delete(key);
            }
        }
    }

    groups.set(privateGroupId, {
        id: privateGroupId,
        name: 'Private group',
        description: 'Members only',
        iconUrl: null,
        coverUrl: null,
        visibility: 'private',
        memberCanPost: false,
        memberCanCreateEvents: false,
        createdBy: adminId,
        createdAt: new Date()
    });
    groups.set('eeeeeeeeeeeeeeeeeeeeeeee', {
        id: 'eeeeeeeeeeeeeeeeeeeeeeee',
        name: 'Public group',
        description: 'Public description',
        visibility: 'public',
        createdBy: adminId,
        createdAt: new Date()
    });
    groups.set(secretGroupId, {
        id: secretGroupId,
        name: 'Secret group',
        description: 'Invitation only',
        visibility: 'secret',
        createdBy: adminId
    });
    createMembership({
        groupId: privateGroupId,
        userId: adminId,
        role: 'admin',
        status: 'active',
        joinedAt: new Date()
    });
    createMembership({
        groupId: secretGroupId,
        userId: adminId,
        role: 'admin',
        status: 'active',
        joinedAt: new Date()
    });

    const User = {
        async findById(id) {
            return [adminId, memberId, inviteeId].includes(String(id)) ? { id: String(id) } : null;
        }
    };

    return { Group, GroupMembership, User, groups, memberships };
}

async function startApi() {
    const models = createModels();
    const app = express();
    app.use(express.json());
    app.use('/api/groups', createGroupsRouter({ ...models, jwtSecret }));
    app.use((error, req, res, next) => {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    });

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    return {
        ...models,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        })
    };
}

function authHeaders(userId) {
    return { authorization: `Bearer ${tokenFor(userId)}` };
}

test('group privacy, membership requests, invitations, and administrator safeguards', async (t) => {
    const api = await startApi();
    t.after(api.close);

    const privateSummary = await fetch(`${api.baseUrl}/api/groups/${privateGroupId}`);
    assert.equal(privateSummary.status, 200);
    const summaryBody = await privateSummary.json();
    assert.equal(summaryBody.group.name, 'Private group');
    assert.equal('description' in summaryBody.group, false);

    const groupList = await fetch(`${api.baseUrl}/api/groups`);
    assert.equal(groupList.status, 200);
    const listedGroups = (await groupList.json()).groups;
    assert.equal(listedGroups.some((group) => group.visibility === 'secret'), false);
    assert.equal('description' in listedGroups.find((group) => group.visibility === 'private'), false);

    const secretGroup = await fetch(`${api.baseUrl}/api/groups/${secretGroupId}`);
    assert.equal(secretGroup.status, 404);

    const secretJoin = await fetch(`${api.baseUrl}/api/groups/${secretGroupId}/membership`, {
        method: 'POST',
        headers: authHeaders(memberId)
    });
    assert.equal(secretJoin.status, 403);

    const joinRequest = await fetch(`${api.baseUrl}/api/groups/${privateGroupId}/membership`, {
        method: 'POST',
        headers: authHeaders(memberId)
    });
    assert.equal(joinRequest.status, 202);
    assert.equal((await joinRequest.json()).membership.status, 'pending');

    const requests = await fetch(`${api.baseUrl}/api/groups/${privateGroupId}/membership-requests`, {
        headers: authHeaders(adminId)
    });
    assert.equal(requests.status, 200);
    assert.equal((await requests.json()).requests[0].userId, memberId);

    const approved = await fetch(
        `${api.baseUrl}/api/groups/${privateGroupId}/members/${memberId}/approve`,
        { method: 'POST', headers: authHeaders(adminId) }
    );
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).membership.status, 'active');

    const invite = await fetch(`${api.baseUrl}/api/groups/${secretGroupId}/invitations`, {
        method: 'POST',
        headers: { ...authHeaders(adminId), 'content-type': 'application/json' },
        body: JSON.stringify({ userId: inviteeId })
    });
    assert.equal(invite.status, 201);

    const acceptInvite = await fetch(`${api.baseUrl}/api/groups/${secretGroupId}/invitations/accept`, {
        method: 'POST',
        headers: authHeaders(inviteeId)
    });
    assert.equal(acceptInvite.status, 200);
    assert.equal((await acceptInvite.json()).membership.status, 'active');

    const adminList = await fetch(`${api.baseUrl}/api/groups/${privateGroupId}/members`, {
        headers: authHeaders(adminId)
    });
    assert.equal(adminList.status, 200);

    const demoteLastAdmin = await fetch(
        `${api.baseUrl}/api/groups/${privateGroupId}/members/${adminId}/role`,
        {
            method: 'PATCH',
            headers: { ...authHeaders(adminId), 'content-type': 'application/json' },
            body: JSON.stringify({ role: 'member' })
        }
    );
    assert.equal(demoteLastAdmin.status, 409);

    const createGroup = await fetch(`${api.baseUrl}/api/groups`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify({
            name: 'Created group',
            description: 'A group created through the API',
            visibility: 'public'
        })
    });
    assert.equal(createGroup.status, 201);
    const createdBody = await createGroup.json();
    assert.equal(api.memberships.get(`${createdBody.group.id}:${memberId}`).role, 'admin');
});
