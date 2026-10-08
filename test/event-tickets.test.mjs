import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';
import jwt from 'jsonwebtoken';

import createEventTicketsRouter from '../src/routes/event-tickets.mjs';

const jwtSecret = 'test-secret-that-is-long-enough-for-the-api';
const organizerId = '111111111111111111111111';
const participantId = '222222222222222222222222';
const eventId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const privateEventId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ticketTypeId = 'cccccccccccccccccccccccc';

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
        if (key === 'buyer.email') {
            return document.buyer.email === expected;
        }
        if (key === '$expr') {
            return document.sold < document.quantity;
        }
        if (expected && typeof expected === 'object' && '$gt' in expected) {
            return actual > expected.$gt;
        }
        return String(actual) === String(expected);
    });
}

function createModels() {
    const ticketTypes = new Map();
    const tickets = new Map();
    let nextTypeId = ticketTypeId;
    let nextTicketId = 0;

    class EventTicketType {
        static async create(data) {
            const ticketType = {
                id: nextTypeId,
                sold: 0,
                currency: 'EUR',
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
                async save() {
                    this.updatedAt = new Date();
                    ticketTypes.set(this.id, this);
                },
                async deleteOne() {
                    ticketTypes.delete(this.id);
                }
            };
            nextTypeId = 'dddddddddddddddddddddddd';
            ticketTypes.set(ticketType.id, ticketType);
            return ticketType;
        }

        static async findOne(query) {
            return [...ticketTypes.values()].find((type) => matches(type, query)) || null;
        }

        static find(query) {
            const result = [...ticketTypes.values()].filter((type) => matches(type, query));
            return {
                sort: async () => result
            };
        }

        static async findOneAndUpdate(query, update) {
            const ticketType = [...ticketTypes.values()].find((type) => matches(type, query));
            if (!ticketType) return null;
            ticketType.sold += update.$inc.sold;
            return ticketType;
        }

        static async updateOne(query, update) {
            const ticketType = [...ticketTypes.values()].find((type) => matches(type, query));
            if (!ticketType) return { modifiedCount: 0 };
            ticketType.sold += update.$inc.sold;
            return { modifiedCount: 1 };
        }

        static async findOneAndDelete(query) {
            const ticketType = [...ticketTypes.values()].find((type) => matches(type, query));
            if (!ticketType) return null;
            ticketTypes.delete(ticketType.id);
            return ticketType;
        }
    }

    class EventTicket {
        static async findOne(query) {
            return [...tickets.values()].find((ticket) => matches(ticket, query)) || null;
        }

        static async create(data) {
            if ([...tickets.values()].some((ticket) =>
                ticket.eventId === data.eventId && ticket.buyer.email === data.buyer.email
            )) {
                const error = new Error('Duplicate ticket buyer');
                error.code = 11000;
                throw error;
            }
            nextTicketId += 1;
            const ticket = {
                id: nextTicketId.toString(16).padStart(24, '0'),
                ...data
            };
            tickets.set(ticket.id, ticket);
            return ticket;
        }

        static find(query) {
            const result = [...tickets.values()].filter((ticket) => matches(ticket, query));
            return {
                sort: async () => result
            };
        }
    }

    const Event = {
        async findById(id) {
            if (String(id) === eventId) return { id: eventId, visibility: 'public' };
            if (String(id) === privateEventId) return { id: privateEventId, visibility: 'private' };
            return null;
        }
    };
    const EventParticipation = {
        async findOne(query) {
            return String(query.userId) === organizerId
                && query.role === 'organizer'
                && query.status === 'going'
                ? { role: 'organizer', status: 'going' }
                : null;
        }
    };

    return { Event, EventParticipation, EventTicketType, EventTicket, ticketTypes, tickets };
}

async function startApi() {
    const models = createModels();
    const app = express();
    app.use(express.json());
    app.use('/api/events', createEventTicketsRouter({ ...models, jwtSecret }));
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

test('ticket types and ticket registration enforce public event, stock, unique buyer, and organizer permissions', async (t) => {
    const api = await startApi();
    t.after(api.close);

    const privateType = await fetch(`${api.baseUrl}/api/events/${privateEventId}/ticket-types`, {
        method: 'POST',
        headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Private ticket', priceCents: 1000, quantity: 5 })
    });
    assert.equal(privateType.status, 409);

    const invalidType = await fetch(`${api.baseUrl}/api/events/${eventId}/ticket-types`, {
        method: 'POST',
        headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Invalid', priceCents: 1.5, quantity: 5 })
    });
    assert.equal(invalidType.status, 400);

    const createdType = await fetch(`${api.baseUrl}/api/events/${eventId}/ticket-types`, {
        method: 'POST',
        headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Early bird', priceCents: 2500, quantity: 2 })
    });
    assert.equal(createdType.status, 201);
    const ticketType = (await createdType.json()).ticketType;
    assert.equal(ticketType.currency, 'EUR');
    assert.equal(ticketType.available, 2);

    const deniedTypeCreate = await fetch(`${api.baseUrl}/api/events/${eventId}/ticket-types`, {
        method: 'POST',
        headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Another type', priceCents: 1000, quantity: 5 })
    });
    assert.equal(deniedTypeCreate.status, 403);

    const purchase = await fetch(`${api.baseUrl}/api/events/${eventId}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            ticketTypeId: ticketType.id,
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: ' ADA@example.com ',
            fullAddress: '12 Analytical Engine Street, London'
        })
    });
    assert.equal(purchase.status, 201);
    const ticket = (await purchase.json()).ticket;
    assert.equal(ticket.buyer.email, 'ada@example.com');
    assert.equal(ticket.priceCents, 2500);
    assert.equal(ticket.paymentStatus, 'not_integrated');

    const secondPurchase = await fetch(`${api.baseUrl}/api/events/${eventId}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            ticketTypeId: ticketType.id,
            firstName: 'Grace',
            lastName: 'Hopper',
            email: 'grace@example.com',
            fullAddress: '34 Compiler Lane, New York'
        })
    });
    assert.equal(secondPurchase.status, 201);

    const duplicatePurchase = await fetch(`${api.baseUrl}/api/events/${eventId}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            ticketTypeId: ticketType.id,
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            fullAddress: '12 Analytical Engine Street, London'
        })
    });
    assert.equal(duplicatePurchase.status, 409);
    assert.equal(api.ticketTypes.get(ticketType.id).sold, 2);

    const soldOut = await fetch(`${api.baseUrl}/api/events/${eventId}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            ticketTypeId: ticketType.id,
            firstName: 'Katherine',
            lastName: 'Johnson',
            email: 'katherine@example.com',
            fullAddress: '1 Spaceflight Road, Virginia'
        })
    });
    assert.equal(soldOut.status, 409);

    const createRaceType = await fetch(`${api.baseUrl}/api/events/${eventId}/ticket-types`, {
        method: 'POST',
        headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Standard', priceCents: 3500, quantity: 2 })
    });
    const raceType = (await createRaceType.json()).ticketType;
    const concurrentPurchases = await Promise.all([1, 2].map(() =>
        fetch(`${api.baseUrl}/api/events/${eventId}/tickets`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ticketTypeId: raceType.id,
                firstName: 'Grace',
                lastName: 'Hopper',
                email: 'race@example.com',
                fullAddress: '34 Compiler Lane, New York'
            })
        })
    ));
    assert.deepEqual(
        concurrentPurchases.map((result) => result.status).sort(),
        [201, 409]
    );
    assert.equal(api.ticketTypes.get(raceType.id).sold, 1);

    const lowerThanSold = await fetch(
        `${api.baseUrl}/api/events/${eventId}/ticket-types/${ticketType.id}`,
        {
            method: 'PATCH',
            headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
            body: JSON.stringify({ quantity: 1 })
        }
    );
    assert.equal(lowerThanSold.status, 409);

    const deleteSoldType = await fetch(
        `${api.baseUrl}/api/events/${eventId}/ticket-types/${ticketType.id}`,
        { method: 'DELETE', headers: authHeaders(organizerId) }
    );
    assert.equal(deleteSoldType.status, 409);

    const organizerTickets = await fetch(`${api.baseUrl}/api/events/${eventId}/tickets`, {
        headers: authHeaders(organizerId)
    });
    assert.equal(organizerTickets.status, 200);
    assert.equal((await organizerTickets.json()).tickets.length, 3);
});
