import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';
import jwt from 'jsonwebtoken';

import createDiscussionRouter from '../src/routes/discussion.mjs';

const jwtSecret = 'test-secret-that-is-long-enough-for-the-api';
const memberId = '111111111111111111111111';
const adminId = '222222222222222222222222';
const participantId = '333333333333333333333333';
const outsiderId = '444444444444444444444444';
const groupId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const eventId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const unconfirmedEventId = 'cccccccccccccccccccccccc';

function tokenFor(userId) {
    return jwt.sign({}, jwtSecret, {
        subject: userId,
        expiresIn: '1h',
        issuer: 'social-network-api',
        audience: 'social-network-api'
    });
}

function matches(document, query) {
    return Object.entries(query).every(([key, expected]) => {
        const actual = key === '_id' ? (document._id ?? document.id) : document[key];
        if (expected && typeof expected === 'object' && '$in' in expected) {
            return expected.$in.some((value) => String(value) === String(actual));
        }
        if (expected && typeof expected === 'object' && '$lt' in expected) {
            return actual < expected.$lt;
        }
        return String(actual) === String(expected);
    });
}

function createModels() {
    const threads = new Map();
    const messages = new Map();
    const group = { id: groupId, memberCanPost: false };
    let nextMessageId = 0;

    const Group = {
        async findById(id) {
            return String(id) === groupId ? group : null;
        }
    };
    const GroupMembership = {
        async findOne(query) {
            if (String(query.groupId) !== groupId || query.status !== 'active') return null;
            if (String(query.userId) === adminId) {
                return { role: 'admin', status: 'active' };
            }
            if (String(query.userId) === memberId) {
                return { role: 'member', status: 'active' };
            }
            return null;
        }
    };
    const Event = {
        async findById(id) {
            return [eventId, unconfirmedEventId].includes(String(id))
                ? { id: String(id) }
                : null;
        }
    };
    const EventParticipation = {
        async findOne(query) {
            if (String(query.eventId) !== eventId
                || String(query.userId) !== participantId
                || query.status !== 'going') {
                return null;
            }
            return { role: 'participant', status: 'going' };
        }
    };
    const DiscussionThread = {
        async findOne(query) {
            return [...threads.values()].find((thread) => matches(thread, query)) || null;
        },
        async create(data) {
            const existing = [...threads.values()].find((thread) => matches(thread, data));
            if (existing) {
                const error = new Error('Duplicate thread');
                error.code = 11000;
                throw error;
            }
            const thread = {
                id: `thread-${threads.size + 1}`,
                ...data
            };
            threads.set(thread.id, thread);
            return thread;
        }
    };
    const DiscussionMessage = {
        async create(data) {
            nextMessageId += 1;
            const message = {
                id: nextMessageId.toString(16).padStart(24, '0'),
                createdAt: new Date(Date.now() + nextMessageId),
                updatedAt: new Date(Date.now() + nextMessageId),
                ...data
            };
            messages.set(message.id, message);
            return message;
        },
        async findOne(query) {
            return [...messages.values()].find((message) => matches(message, query)) || null;
        },
        find(query) {
            const result = [...messages.values()].filter((message) => matches(message, query));
            return {
                sort() {
                    result.sort((left, right) => right.createdAt - left.createdAt);
                    return this;
                },
                async limit(limit) {
                    return result.slice(0, limit);
                }
            };
        }
    };

    return {
        Group,
        GroupMembership,
        Event,
        EventParticipation,
        DiscussionThread,
        DiscussionMessage,
        group,
        threads,
        messages
    };
}

async function startApi() {
    const models = createModels();
    const app = express();
    app.use(express.json());
    app.use('/api/groups', createDiscussionRouter({
        ...models,
        context: 'group',
        jwtSecret
    }));
    app.use('/api/events', createDiscussionRouter({
        ...models,
        context: 'event',
        jwtSecret
    }));
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

test('group and event discussions enforce access and accept direct replies', async (t) => {
    const api = await startApi();
    t.after(api.close);

    const deniedGroupPost = await fetch(`${api.baseUrl}/api/groups/${groupId}/discussion/messages`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Should be blocked' })
    });
    assert.equal(deniedGroupPost.status, 403);

    const deniedGroupRead = await fetch(`${api.baseUrl}/api/groups/${groupId}/discussion/messages`, {
        headers: authHeaders(outsiderId)
    });
    assert.equal(deniedGroupRead.status, 403);

    const adminPost = await fetch(`${api.baseUrl}/api/groups/${groupId}/discussion/messages`, {
        method: 'POST',
        headers: { ...authHeaders(adminId), 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Admin post' })
    });
    assert.equal(adminPost.status, 201);
    const adminMessage = (await adminPost.json()).message;

    api.group.memberCanPost = true;
    const memberPost = await fetch(`${api.baseUrl}/api/groups/${groupId}/discussion/messages`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Member post' })
    });
    assert.equal(memberPost.status, 201);
    const memberMessage = (await memberPost.json()).message;

    const reply = await fetch(
        `${api.baseUrl}/api/groups/${groupId}/discussion/messages/${memberMessage.id}/replies`,
        {
            method: 'POST',
            headers: { ...authHeaders(adminId), 'content-type': 'application/json' },
            body: JSON.stringify({ content: 'A reply' })
        }
    );
    assert.equal(reply.status, 201);
    const replyBody = await reply.json();
    assert.equal(replyBody.message.replyTo, memberMessage.id);

    const replyToReply = await fetch(
        `${api.baseUrl}/api/groups/${groupId}/discussion/messages/${replyBody.message.id}/replies`,
        {
            method: 'POST',
            headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
            body: JSON.stringify({ content: 'Nested replies are not supported' })
        }
    );
    assert.equal(replyToReply.status, 404);

    const groupMessages = await fetch(
        `${api.baseUrl}/api/groups/${groupId}/discussion/messages?limit=2`,
        { headers: authHeaders(memberId) }
    );
    assert.equal(groupMessages.status, 200);
    assert.equal((await groupMessages.json()).messages.length, 2);

    const invalidLimit = await fetch(
        `${api.baseUrl}/api/groups/${groupId}/discussion/messages?limit=101`,
        { headers: authHeaders(adminId) }
    );
    assert.equal(invalidLimit.status, 400);

    const invalidContent = await fetch(`${api.baseUrl}/api/groups/${groupId}/discussion/messages`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify({ content: '   ' })
    });
    assert.equal(invalidContent.status, 400);

    const unconfirmedEventPost = await fetch(
        `${api.baseUrl}/api/events/${unconfirmedEventId}/discussion/messages`,
        {
            method: 'POST',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({ content: 'Not confirmed' })
        }
    );
    assert.equal(unconfirmedEventPost.status, 403);

    const eventPost = await fetch(`${api.baseUrl}/api/events/${eventId}/discussion/messages`, {
        method: 'POST',
        headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Confirmed attendee message' })
    });
    assert.equal(eventPost.status, 201);
    const eventMessage = (await eventPost.json()).message;
    assert.notEqual(eventMessage.threadId, adminMessage.threadId);
    assert.equal(api.threads.size, 2);
});
