import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import openApiDocument from '../src/docs/openapi.mjs';
import Server from '../src/server.mjs';

function collectReferences(value, references = []) {
    if (Array.isArray(value)) {
        for (const item of value) collectReferences(item, references);
    } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            if (key === '$ref') references.push(item);
            else collectReferences(item, references);
        }
    }
    return references;
}

function resolveLocalReference(reference) {
    assert.ok(reference.startsWith('#/'), `Expected a local reference, got ${reference}`);
    return reference.slice(2).split('/').reduce((value, key) => value?.[key], openApiDocument);
}

test('OpenAPI document describes every implemented API operation with resolvable schemas', () => {
    assert.equal(openApiDocument.openapi, '3.0.3');
    assert.equal(openApiDocument.paths['/api-docs'], undefined);

    const operations = Object.values(openApiDocument.paths).flatMap((path) =>
        Object.entries(path).map(([method, operation]) => ({ method, operation }))
    );
    assert.equal(operations.length, 57);

    for (const { method, operation } of operations) {
        assert.ok(['get', 'post', 'put', 'patch', 'delete'].includes(method));
        assert.ok(operation.summary);
        assert.ok(operation.tags?.length);
        assert.ok(operation.responses && Object.keys(operation.responses).length > 0);
    }

    for (const reference of collectReferences(openApiDocument)) {
        assert.notEqual(resolveLocalReference(reference), undefined, `Unresolved OpenAPI reference: ${reference}`);
    }
});

test('Swagger UI is served by the API', async (t) => {
    const server = new Server();
    server.config = { jwtSecret: 'test-secret-that-is-long-enough-for-the-api' };
    const emptyModel = {};
    server.middleware({
        User: emptyModel,
        Group: emptyModel,
        GroupMembership: emptyModel,
        Event: emptyModel,
        EventParticipation: emptyModel,
        DiscussionThread: emptyModel,
        DiscussionMessage: emptyModel,
        EventAlbum: emptyModel,
        EventPhoto: emptyModel,
        PhotoComment: emptyModel,
        EventPoll: emptyModel,
        PollResponse: emptyModel,
        EventTicketType: emptyModel,
        EventTicket: emptyModel
    });

    const httpServer = server.app.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    t.after(() => new Promise((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve());
    }));

    const { port } = httpServer.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const swaggerUi = await fetch(`${baseUrl}/api-docs/`);
    assert.equal(swaggerUi.status, 200);
    assert.match(await swaggerUi.text(), /Swagger UI/);
});
