import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';
import jwt from 'jsonwebtoken';

import createEventAlbumsRouter from '../src/routes/event-albums.mjs';

const jwtSecret = 'test-secret-that-is-long-enough-for-the-api';
const organizerId = '111111111111111111111111';
const participantId = '222222222222222222222222';
const otherParticipantId = '333333333333333333333333';
const interestedUserId = '444444444444444444444444';
const outsiderId = '555555555555555555555555';
const eventId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const otherEventId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const albumId = 'cccccccccccccccccccccccc';

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
    const albums = new Map();
    const photos = new Map();
    const comments = new Map();
    let nextAlbumId = 'dddddddddddddddddddddddd';
    let nextPhotoId = 0;
    let nextCommentId = 0;

    albums.set(albumId, {
        id: albumId,
        eventId,
        name: 'Event photos',
        createdBy: organizerId,
        createdAt: new Date(),
        updatedAt: new Date(),
        async save() {
            albums.set(this.id, this);
        },
        async deleteOne() {
            albums.delete(this.id);
        }
    });

    const Event = {
        async findById(id) {
            return [eventId, otherEventId].includes(String(id)) ? { id: String(id) } : null;
        }
    };
    const EventParticipation = {
        async findOne(query) {
            if (String(query.eventId) !== eventId || query.status !== 'going') return null;
            const userId = String(query.userId);
            if (userId === organizerId) return { role: 'organizer', status: 'going' };
            if ([participantId, otherParticipantId].includes(userId)) {
                return { role: 'participant', status: 'going' };
            }
            return null;
        }
    };
    const EventAlbum = {
        async create(data) {
            const album = {
                id: nextAlbumId,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
                async save() {
                    albums.set(this.id, this);
                },
                async deleteOne() {
                    albums.delete(this.id);
                }
            };
            nextAlbumId = 'eeeeeeeeeeeeeeeeeeeeeeee';
            albums.set(album.id, album);
            return album;
        },
        async findOne(query) {
            return [...albums.values()].find((album) => matches(album, query)) || null;
        },
        find(query) {
            const result = [...albums.values()].filter((album) => matches(album, query));
            return {
                sort() {
                    return this;
                },
                select() {
                    return Promise.resolve(result);
                },
                then(resolve, reject) {
                    return Promise.resolve(result).then(resolve, reject);
                }
            };
        }
    };
    const EventPhoto = {
        async create(data) {
            nextPhotoId += 1;
            const photo = {
                id: nextPhotoId.toString(16).padStart(24, '0'),
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
                async deleteOne() {
                    photos.delete(this.id);
                }
            };
            photos.set(photo.id, photo);
            return photo;
        },
        async findOne(query) {
            return [...photos.values()].find((photo) => matches(photo, query)) || null;
        },
        find(query) {
            const result = [...photos.values()].filter((photo) => matches(photo, query));
            return {
                sort() {
                    return this;
                },
                select() {
                    return Promise.resolve(result);
                },
                then(resolve, reject) {
                    return Promise.resolve(result).then(resolve, reject);
                }
            };
        },
        async deleteMany(query) {
            for (const [id, photo] of photos) {
                if (matches(photo, query)) photos.delete(id);
            }
        }
    };
    const PhotoComment = {
        async create(data) {
            nextCommentId += 1;
            const comment = {
                id: (100 + nextCommentId).toString(16).padStart(24, '0'),
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
                async deleteOne() {
                    comments.delete(this.id);
                }
            };
            comments.set(comment.id, comment);
            return comment;
        },
        async findOne(query) {
            return [...comments.values()].find((comment) => matches(comment, query)) || null;
        },
        find(query) {
            const result = [...comments.values()].filter((comment) => matches(comment, query));
            return {
                sort() {
                    return this;
                },
                then(resolve, reject) {
                    return Promise.resolve(result).then(resolve, reject);
                }
            };
        },
        async deleteMany(query) {
            for (const [id, comment] of comments) {
                const photoMatches = query.photoId?.$in
                    ? query.photoId.$in.some((photoId) => String(photoId) === String(comment.photoId))
                    : matches(comment, query);
                if (photoMatches) comments.delete(id);
            }
        }
    };

    return { Event, EventParticipation, EventAlbum, EventPhoto, PhotoComment, albums, photos, comments };
}

async function startApi() {
    const models = createModels();
    const app = express();
    app.use(express.json());
    app.use('/api/events', createEventAlbumsRouter({ ...models, jwtSecret }));
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

test('event albums, photos, and comments respect confirmed participation and organizer permissions', async (t) => {
    const api = await startApi();
    t.after(api.close);

    const unauthorizedList = await fetch(`${api.baseUrl}/api/events/${eventId}/albums`, {
        headers: authHeaders(interestedUserId)
    });
    assert.equal(unauthorizedList.status, 403);

    const unauthorizedAlbumCreate = await fetch(`${api.baseUrl}/api/events/${eventId}/albums`, {
        method: 'POST',
        headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Should not be created' })
    });
    assert.equal(unauthorizedAlbumCreate.status, 403);

    const createAlbum = await fetch(`${api.baseUrl}/api/events/${eventId}/albums`, {
        method: 'POST',
        headers: { ...authHeaders(organizerId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'After party' })
    });
    assert.equal(createAlbum.status, 201);
    const createdAlbum = (await createAlbum.json()).album;

    const invalidImage = await fetch(
        `${api.baseUrl}/api/events/${eventId}/albums/${createdAlbum.id}/photos`,
        {
            method: 'POST',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({ imageUrl: 'http://images.example/photo.jpg' })
        }
    );
    assert.equal(invalidImage.status, 400);

    const addPhoto = await fetch(
        `${api.baseUrl}/api/events/${eventId}/albums/${albumId}/photos`,
        {
            method: 'POST',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({
                imageUrl: 'https://images.example/photo.jpg',
                caption: 'Good times',
                altText: 'Friends at the event'
            })
        }
    );
    assert.equal(addPhoto.status, 201);
    const photo = (await addPhoto.json()).photo;
    assert.equal(photo.uploadedBy, participantId);

    const wrongEventPhoto = await fetch(
        `${api.baseUrl}/api/events/${otherEventId}/albums/${albumId}/photos`,
        {
            method: 'POST',
            headers: { ...authHeaders(participantId), 'content-type': 'application/json' },
            body: JSON.stringify({ imageUrl: 'https://images.example/another.jpg' })
        }
    );
    assert.equal(wrongEventPhoto.status, 403);

    const nonParticipantComment = await fetch(
        `${api.baseUrl}/api/events/${eventId}/albums/${albumId}/photos/${photo.id}/comments`,
        {
            method: 'POST',
            headers: { ...authHeaders(outsiderId), 'content-type': 'application/json' },
            body: JSON.stringify({ content: 'Not allowed' })
        }
    );
    assert.equal(nonParticipantComment.status, 403);

    const addComment = await fetch(
        `${api.baseUrl}/api/events/${eventId}/albums/${albumId}/photos/${photo.id}/comments`,
        {
            method: 'POST',
            headers: { ...authHeaders(otherParticipantId), 'content-type': 'application/json' },
            body: JSON.stringify({ content: 'Great photo!' })
        }
    );
    assert.equal(addComment.status, 201);
    const comment = (await addComment.json()).comment;

    const denyCommentDelete = await fetch(
        `${api.baseUrl}/api/events/${eventId}/albums/${albumId}/photos/${photo.id}/comments/${comment.id}`,
        { method: 'DELETE', headers: authHeaders(participantId) }
    );
    assert.equal(denyCommentDelete.status, 403);

    const authorDelete = await fetch(
        `${api.baseUrl}/api/events/${eventId}/albums/${albumId}/photos/${photo.id}/comments/${comment.id}`,
        { method: 'DELETE', headers: authHeaders(otherParticipantId) }
    );
    assert.equal(authorDelete.status, 204);

    const listPhotos = await fetch(
        `${api.baseUrl}/api/events/${eventId}/albums/${albumId}/photos`,
        { headers: authHeaders(participantId) }
    );
    assert.equal(listPhotos.status, 200);
    assert.equal((await listPhotos.json()).photos.length, 1);
});
