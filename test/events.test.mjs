import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';
import jwt from 'jsonwebtoken';

import createEventsRouter from '../src/routes/events.mjs';

const jwtSecret = 'test-secret-that-is-long-enough-for-the-api';
const adminId = '111111111111111111111111';
const memberId = '222222222222222222222222';
const inviteeId = '333333333333333333333333';
const outsiderId = '444444444444444444444444';
const privateGroupId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const publicGroupId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

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
            return expected.$in.includes(actual);
        }
        if (expected && typeof expected === 'object' && '$ne' in expected) {
            return actual !== expected.$ne;
        }
        return String(actual) === String(expected);
    });
}

function createModels() {
    const events = new Map();
    const participations = new Map();
    const groups = new Map([
        [privateGroupId, {
            id: privateGroupId,
            visibility: 'private',
            memberCanCreateEvents: false
        }],
        [publicGroupId, {
            id: publicGroupId,
            visibility: 'public',
            memberCanCreateEvents: true
        }]
    ]);
    const groupMemberships = [
        { groupId: privateGroupId, userId: adminId, role: 'admin', status: 'active' },
        { groupId: privateGroupId, userId: memberId, role: 'member', status: 'active' },
        { groupId: publicGroupId, userId: adminId, role: 'admin', status: 'active' },
        { groupId: publicGroupId, userId: memberId, role: 'member', status: 'active' }
    ];
    let nextEventId = 'cccccccccccccccccccccccc';

    function participationKey(eventId, userId) {
        return `${eventId}:${userId}`;
    }

    function createParticipation(data) {
        const key = participationKey(data.eventId, data.userId);
        if (participations.has(key)) {
            const error = new Error('Duplicate participation');
            error.code = 11000;
            throw error;
        }
        const participation = {
            respondedAt: null,
            ...data,
            async save() {
                participations.set(key, this);
            },
            async deleteOne() {
                participations.delete(key);
            }
        };
        participations.set(key, participation);
        return participation;
    }

    class Event {
        static async create(data) {
            const id = nextEventId;
            nextEventId = 'dddddddddddddddddddddddd';
            const event = {
                id,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
                async save() {
                    events.set(this.id, this);
                },
                async deleteOne() {
                    events.delete(this.id);
                }
            };
            events.set(id, event);
            return event;
        }

        static async findById(id) {
            return events.get(String(id)) || null;
        }

        static find(query) {
            const result = [...events.values()].filter((event) => matches(event, query));
            return {
                sort: async () => result,
                select: async () => result
            };
        }

        static async deleteOne({ _id }) {
            events.delete(String(_id));
        }
    }

    class EventParticipation {
        static async create(data) {
            return createParticipation(data);
        }

        static async insertMany(rows) {
            return rows.map(createParticipation);
        }

        static async findOne(query) {
            return [...participations.values()].find((item) => matches(item, query)) || null;
        }

        static async findOneAndUpdate(query, update) {
            const participation = [...participations.values()].find((item) => matches(item, query));
            if (!participation) return null;
            Object.assign(participation, update.$set);
            return participation;
        }

        static async countDocuments(query) {
            return [...participations.values()].filter((item) => matches(item, query)).length;
        }

        static find(query) {
            const result = [...participations.values()].filter((item) => matches(item, query));
            return { select: async () => result };
        }

        static async deleteMany({ eventId }) {
            for (const [key, participation] of participations) {
                if (String(participation.eventId) === String(eventId)) {
                    participations.delete(key);
                }
            }
        }
    }

    const Group = {
        async findById(id) {
            return groups.get(String(id)) || null;
        }
    };

    const GroupMembership = {
        async findOne(query) {
            return groupMemberships.find((membership) => matches(membership, query)) || null;
        },
        find(query) {
            const result = groupMemberships.filter((membership) => matches(membership, query));
            return { select: async () => result };
        }
    };

    const User = {
        async findById(id) {
            return [adminId, memberId, inviteeId, outsiderId].includes(String(id))
                ? { id: String(id) }
                : null;
        }
    };

    return {
        Event,
        EventParticipation,
        Group,
        GroupMembership,
        User,
        events,
        participations
    };
}

async function startApi() {
    const models = createModels();
    const app = express();
    app.use(express.json());
    app.use('/api/events', createEventsRouter({ ...models, jwtSecret }));
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

function eventData(overrides = {}) {
    return {
        name: 'Community meetup',
        description: 'A meetup for the community',
        startAt: '2027-06-01T10:00:00.000Z',
        endAt: '2027-06-01T12:00:00.000Z',
        place: 'Main hall',
        visibility: 'public',
        ...overrides
    };
}

test('event visibility, group creation rules, invitations, responses, and organizer safeguards', async (t) => {
    const api = await startApi();
    t.after(api.close);

    const invalidDates = await fetch(`${api.baseUrl}/api/events`, {
        method: 'POST',
        headers: { ...authHeaders(adminId), 'content-type': 'application/json' },
        body: JSON.stringify(eventData({
            startAt: '2027-06-01T12:00:00.000Z',
            endAt: '2027-06-01T10:00:00.000Z'
        }))
    });
    assert.equal(invalidDates.status, 400);

    const deniedGroupEvent = await fetch(`${api.baseUrl}/api/events`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify(eventData({ groupId: privateGroupId }))
    });
    assert.equal(deniedGroupEvent.status, 403);

    const createdPrivateEvent = await fetch(`${api.baseUrl}/api/events`, {
        method: 'POST',
        headers: { ...authHeaders(adminId), 'content-type': 'application/json' },
        body: JSON.stringify(eventData({
            groupId: privateGroupId,
            visibility: 'private'
        }))
    });
    assert.equal(createdPrivateEvent.status, 201);
    const privateEvent = (await createdPrivateEvent.json()).event;
    assert.equal(privateEvent.groupId, privateGroupId);
    assert.equal(
        api.participations.get(`${privateEvent.id}:${memberId}`).status,
        'invited'
    );

    const hiddenPrivateEvent = await fetch(`${api.baseUrl}/api/events/${privateEvent.id}`);
    assert.equal(hiddenPrivateEvent.status, 404);

    const visiblePrivateEvent = await fetch(`${api.baseUrl}/api/events/${privateEvent.id}`, {
        headers: authHeaders(memberId)
    });
    assert.equal(visiblePrivateEvent.status, 200);

    const privateList = await fetch(`${api.baseUrl}/api/events`, {
        headers: authHeaders(memberId)
    });
    assert.equal((await privateList.json()).events.length, 1);
    const outsiderList = await fetch(`${api.baseUrl}/api/events`, {
        headers: authHeaders(outsiderId)
    });
    assert.equal((await outsiderList.json()).events.length, 0);

    const decline = await fetch(`${api.baseUrl}/api/events/${privateEvent.id}/response`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'declined' })
    });
    assert.equal(decline.status, 200);

    const reinvite = await fetch(`${api.baseUrl}/api/events/${privateEvent.id}/invitations`, {
        method: 'POST',
        headers: { ...authHeaders(adminId), 'content-type': 'application/json' },
        body: JSON.stringify({ userId: memberId })
    });
    assert.equal(reinvite.status, 201);

    const accept = await fetch(`${api.baseUrl}/api/events/${privateEvent.id}/response`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'going' })
    });
    assert.equal(accept.status, 200);

    const invalidPrivateRsvp = await fetch(`${api.baseUrl}/api/events/${privateEvent.id}/response`, {
        method: 'POST',
        headers: { ...authHeaders(outsiderId), 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'going' })
    });
    assert.equal(invalidPrivateRsvp.status, 404);

    const memberCreated = await fetch(`${api.baseUrl}/api/events`, {
        method: 'POST',
        headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
        body: JSON.stringify(eventData({ groupId: publicGroupId }))
    });
    assert.equal(memberCreated.status, 201);
    const publicEvent = (await memberCreated.json()).event;

    const publicRsvp = await fetch(`${api.baseUrl}/api/events/${publicEvent.id}/response`, {
        method: 'POST',
        headers: { ...authHeaders(inviteeId), 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'going' })
    });
    assert.equal(publicRsvp.status, 200);

    const promote = await fetch(
        `${api.baseUrl}/api/events/${publicEvent.id}/participants/${inviteeId}/role`,
        {
            method: 'PATCH',
            headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
            body: JSON.stringify({ role: 'organizer' })
        }
    );
    assert.equal(promote.status, 200);

    const demoteSelf = await fetch(
        `${api.baseUrl}/api/events/${publicEvent.id}/participants/${memberId}/role`,
        {
            method: 'PATCH',
            headers: { ...authHeaders(memberId), 'content-type': 'application/json' },
            body: JSON.stringify({ role: 'participant' })
        }
    );
    assert.equal(demoteSelf.status, 200);

    const demoteLastOrganizer = await fetch(
        `${api.baseUrl}/api/events/${publicEvent.id}/participants/${inviteeId}/role`,
        {
            method: 'PATCH',
            headers: { ...authHeaders(inviteeId), 'content-type': 'application/json' },
            body: JSON.stringify({ role: 'participant' })
        }
    );
    assert.equal(demoteLastOrganizer.status, 409);
});
