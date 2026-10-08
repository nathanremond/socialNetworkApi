import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';
import jwt from 'jsonwebtoken';

import createEventPollsRouter from '../src/routes/event-polls.mjs';

const jwtSecret = 'test-secret-that-is-long-enough-for-the-api';
const organizerId = '111111111111111111111111';
const participantId = '222222222222222222222222';
const outsiderId = '333333333333333333333333';
const eventId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const pollId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const questionOneId = 'cccccccccccccccccccccccc';
const questionTwoId = 'dddddddddddddddddddddddd';
const optionOneId = 'eeeeeeeeeeeeeeeeeeeeeeee';
const optionTwoId = 'ffffffffffffffffffffffff';
const optionThreeId = '999999999999999999999999';
const optionFourId = '888888888888888888888888';

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
        return String(actual) === String(expected);
    });
}

function createModels() {
    const poll = {
        id: pollId,
        eventId,
        createdBy: organizerId,
        title: 'Planning',
        questions: [
            {
                id: questionOneId,
                text: 'Which day?',
                options: [
                    { id: optionOneId, text: 'Friday' },
                    { id: optionTwoId, text: 'Saturday' }
                ]
            },
            {
                id: questionTwoId,
                text: 'Which time?',
                options: [
                    { id: optionThreeId, text: 'Morning' },
                    { id: optionFourId, text: 'Evening' }
                ]
            }
        ],
        status: 'open',
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        async save() {
            this.updatedAt = new Date();
        },
        async deleteOne() {}
    };
    const responses = new Map();

    const Event = {
        async findById(id) {
            return String(id) === eventId ? { id: eventId } : null;
        }
    };
    const EventParticipation = {
        async findOne(query) {
            if (String(query.eventId) !== eventId || query.status !== 'going') return null;
            if (String(query.userId) === organizerId) return { role: 'organizer', status: 'going' };
            if (String(query.userId) === participantId) return { role: 'participant', status: 'going' };
            return null;
        }
    };
    const EventPoll = {
        async create(data) {
            return {
                id: pollId,
                ...data,
                questions: data.questions.map((question, questionIndex) => ({
                    id: questionIndex ? questionTwoId : questionOneId,
                    ...question,
                    options: question.options.map((option, optionIndex) => ({
                        id: questionIndex
                            ? (optionIndex ? optionFourId : optionThreeId)
                            : (optionIndex ? optionTwoId : optionOneId),
                        ...option
                    }))
                })),
                createdAt: new Date(),
                updatedAt: new Date(),
                closedAt: null,
                async save() {},
                async deleteOne() {}
            };
        },
        async findOne(query) {
            return matches(poll, query) ? poll : null;
        },
        find() {
            return {
                sort: async () => [poll]
            };
        }
    };
    const PollResponse = {
        find(query) {
            const result = [...responses.values()].filter((response) => matches(response, query));
            return { select: async () => result };
        },
        async         findOneAndUpdate(query, update) {
            const key = `${query.pollId}:${query.userId}`;
            const response = {
                pollId: query.pollId,
                userId: query.userId,
                answers: update.$set.answers,
                updatedAt: new Date()
            };
            responses.set(key, response);
            return response;
        },
        findOne(query) {
            return {
                select: async () =>
                    [...responses.values()].find((response) => matches(response, query)) || null
            };
        },
        async deleteMany({ pollId: responsePollId }) {
            for (const [key, response] of responses) {
                if (String(response.pollId) === String(responsePollId)) responses.delete(key);
            }
        }
    };

    return { Event, EventParticipation, EventPoll, PollResponse, poll, responses };
}

async function startApi() {
    const models = createModels();
    const app = express();
    app.use(express.json());
    app.use('/api/events', createEventPollsRouter({ ...models, jwtSecret }));
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

test('event polls validate answers, allow one choice per question, and can be closed by organizers', async (t) => {
    const api = await startApi();
    t.after(api.close);

    const deniedCreation = await fetch(`${api.baseUrl}/api/events/${eventId}/polls`, {
        method: 'POST',
        headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
        body: JSON.stringify({
            title: 'Plan',
            questions: [{ text: 'Day?', options: ['Friday', 'Saturday'] }]
        })
    });
    assert.equal(deniedCreation.status, 403);

    const invalidPoll = await fetch(`${api.baseUrl}/api/events/${eventId}/polls`, {
        method: 'POST',
        headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
        body: JSON.stringify({
            title: 'Plan',
            questions: [{ text: 'Day?', options: ['Friday'] }]
        })
    });
    assert.equal(invalidPoll.status, 400);

    const createPoll = await fetch(`${api.baseUrl}/api/events/${eventId}/polls`, {
        method: 'POST',
        headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
        body: JSON.stringify({
            title: 'Planning',
            questions: [
                { text: 'Which day?', options: ['Friday', 'Saturday'] },
                { text: 'Which time?', options: ['Morning', 'Evening'] }
            ]
        })
    });
    assert.equal(createPoll.status, 201);
    const createdPoll = (await createPoll.json()).poll;
    assert.equal(createdPoll.questions.length, 2);

    const deniedRead = await fetch(`${api.baseUrl}/api/events/${eventId}/polls`, {
        headers: authHeaders(outsiderId)
    });
    assert.equal(deniedRead.status, 403);

    const incompleteResponse = await fetch(
        `${api.baseUrl}/api/events/${eventId}/polls/${pollId}/response`,
        {
            method: 'PUT',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({
                answers: [{ questionId: questionOneId, optionId: optionOneId }]
            })
        }
    );
    assert.equal(incompleteResponse.status, 400);

    const invalidOption = await fetch(
        `${api.baseUrl}/api/events/${eventId}/polls/${pollId}/response`,
        {
            method: 'PUT',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({
                answers: [
                    { questionId: questionOneId, optionId: optionThreeId },
                    { questionId: questionTwoId, optionId: optionFourId }
                ]
            })
        }
    );
    assert.equal(invalidOption.status, 400);

    const response = await fetch(
        `${api.baseUrl}/api/events/${eventId}/polls/${pollId}/response`,
        {
            method: 'PUT',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({
                answers: [
                    { questionId: questionOneId, optionId: optionTwoId },
                    { questionId: questionTwoId, optionId: optionFourId }
                ]
            })
        }
    );
    assert.equal(response.status, 200);

    const pollDetails = await fetch(`${api.baseUrl}/api/events/${eventId}/polls/${pollId}`, {
        headers: authHeaders(participantId)
    });
    assert.equal(pollDetails.status, 200);
    const details = await pollDetails.json();
    assert.equal(details.results[0].options[1].votes, 1);
    assert.equal(details.results[1].options[1].votes, 1);
    assert.equal(details.myResponse.answers.length, 2);

    const updateResponse = await fetch(
        `${api.baseUrl}/api/events/${eventId}/polls/${pollId}/response`,
        {
            method: 'PUT',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({
                answers: [
                    { questionId: questionOneId, optionId: optionOneId },
                    { questionId: questionTwoId, optionId: optionThreeId }
                ]
            })
        }
    );
    assert.equal(updateResponse.status, 200);
    const updatedDetailsResponse = await fetch(
        `${api.baseUrl}/api/events/${eventId}/polls/${pollId}`,
        { headers: authHeaders(participantId) }
    );
    const updatedDetails = await updatedDetailsResponse.json();
    assert.equal(updatedDetails.results[0].options[0].votes, 1);
    assert.equal(updatedDetails.results[0].options[1].votes, 0);

    const closePoll = await fetch(`${api.baseUrl}/api/events/${eventId}/polls/${pollId}/close`, {
        method: 'POST',
        headers: authHeaders(organizerId)
    });
    assert.equal(closePoll.status, 200);

    const responseAfterClose = await fetch(
        `${api.baseUrl}/api/events/${eventId}/polls/${pollId}/response`,
        {
            method: 'PUT',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({
                answers: [
                    { questionId: questionOneId, optionId: optionOneId },
                    { questionId: questionTwoId, optionId: optionThreeId }
                ]
            })
        }
    );
    assert.equal(responseAfterClose.status, 409);
});
