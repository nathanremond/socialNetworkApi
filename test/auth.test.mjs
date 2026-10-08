import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import express from 'express';

import requireAuth from '../src/middleware/require-auth.mjs';
import createAuthRouter from '../src/routes/auth.mjs';
import createUsersRouter from '../src/routes/users.mjs';

const jwtSecret = 'test-secret-that-is-long-enough-for-the-api';

function createFakeUserModel() {
    const users = new Map();

    return {
        users,
        async create(data) {
            if (users.has(data.email)) {
                const error = new Error('Duplicate email');
                error.code = 11000;
                error.keyPattern = { email: 1 };
                throw error;
            }

            const user = {
                id: randomUUID(),
                createdAt: new Date(),
                ...data
            };
            users.set(user.email, user);
            return user;
        },
        findOne({ email }) {
            return {
                select: async () => users.get(email) || null
            };
        },
        async findById(id) {
            return [...users.values()].find((user) => user.id === id) || null;
        }
    };
}

async function startApi() {
    const User = createFakeUserModel();
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter({ User, jwtSecret }));
    app.use('/api/users', createUsersRouter({ User, jwtSecret }));

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    return {
        User,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        })
    };
}

test('registration, login, and authenticated profile access', async (t) => {
    const api = await startApi();
    t.after(api.close);

    const invalidRegistration = await fetch(`${api.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            password: 'short'
        })
    });
    assert.equal(invalidRegistration.status, 400);

    const registration = await fetch(`${api.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: ' ADA@example.com ',
            password: 'a-long-unique-password'
        })
    });
    assert.equal(registration.status, 201);
    const registered = await registration.json();
    assert.equal(registered.user.email, 'ada@example.com');
    assert.equal('passwordHash' in registered.user, false);
    assert.match(api.User.users.get('ada@example.com').passwordHash, /^\$2[aby]\$/);

    const duplicate = await fetch(`${api.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            password: 'another-long-password'
        })
    });
    assert.equal(duplicate.status, 409);

    const invalidLogin = await fetch(`${api.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ada@example.com', password: 'incorrect-password' })
    });
    assert.equal(invalidLogin.status, 401);

    const login = await fetch(`${api.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ADA@example.com', password: 'a-long-unique-password' })
    });
    assert.equal(login.status, 200);
    const loggedIn = await login.json();

    const unauthenticatedProfile = await fetch(`${api.baseUrl}/api/users/me`);
    assert.equal(unauthenticatedProfile.status, 401);

    const profile = await fetch(`${api.baseUrl}/api/users/me`, {
        headers: { authorization: `Bearer ${loggedIn.token}` }
    });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).user.email, 'ada@example.com');

    const invalidToken = await fetch(`${api.baseUrl}/api/users/me`, {
        headers: { authorization: 'Bearer invalid-token' }
    });
    assert.equal(invalidToken.status, 401);
});
