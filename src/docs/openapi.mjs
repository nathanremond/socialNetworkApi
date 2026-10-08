const jsonResponse = (description, schema = { $ref: '#/components/schemas/Message' }) => ({
    description,
    content: { 'application/json': { schema } }
});

const noContentResponse = { description: 'Opération effectuée sans contenu de réponse.' };

const standardErrors = {
    400: jsonResponse('Données invalides.', { $ref: '#/components/schemas/ValidationError' }),
    401: jsonResponse('Authentification requise ou jeton invalide.'),
    403: jsonResponse('Droits insuffisants.'),
    404: jsonResponse('Ressource introuvable.'),
    409: jsonResponse('Conflit avec l’état actuel de la ressource.'),
    500: jsonResponse('Erreur interne.')
};

const pathParameters = (path) => [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: `Identifiant de ${name}.`
}));

function operation(method, summary, {
    tag,
    path,
    auth = false,
    optionalAuth = false,
    body,
    query = [],
    success = 200,
    response = { $ref: '#/components/schemas/Message' },
    description,
    extraResponses = {}
}) {
    const responses = {
        [success]: success === 204
            ? noContentResponse
            : jsonResponse('Succès.', response),
        ...extraResponses
    };

    if (body) {
        responses[400] ??= standardErrors[400];
    }
    if (auth || optionalAuth) {
        responses[401] ??= standardErrors[401];
    }

    return {
        summary,
        ...(description ? { description } : {}),
        tags: [tag],
        ...(auth
            ? { security: [{ BearerAuth: [] }] }
            : optionalAuth
                ? { security: [{ BearerAuth: [] }, {}] }
                : {}),
        parameters: [
            ...pathParameters(path),
            ...query.map((parameter) => ({
                name: parameter.name,
                in: 'query',
                required: false,
                schema: parameter.schema,
                description: parameter.description
            }))
        ],
        ...(body ? {
            requestBody: {
                required: true,
                content: { 'application/json': { schema: { $ref: `#/components/schemas/${body}` } } }
            }
        } : {}),
        responses: {
            ...responses,
            default: jsonResponse('Erreur non spécifique.')
        }
    };
}

const p = (path) => `/${path}`;
const paths = {};

function add(path, method, summary, options) {
    paths[path] ??= {};
    paths[path][method] = operation(method, summary, { ...options, path });
}

const authTag = 'Authentification et utilisateurs';
add(p('api/auth/register'), 'post', 'Créer un compte', {
    tag: authTag,
    body: 'RegisterRequest',
    success: 201,
    response: { $ref: '#/components/schemas/AuthResponse' },
    extraResponses: {
        409: jsonResponse('Un compte utilisant déjà cet e-mail existe.')
    }
});
add(p('api/auth/login'), 'post', 'Se connecter', {
    tag: authTag,
    body: 'LoginRequest',
    response: { $ref: '#/components/schemas/AuthResponse' },
    extraResponses: { 401: standardErrors[401] }
});
add(p('api/users/me'), 'get', 'Obtenir le profil du compte connecté', {
    tag: authTag,
    auth: true,
    response: { $ref: '#/components/schemas/UserEnvelope' }
});

const groupTag = 'Groupes';
add(p('api/groups'), 'get', 'Lister les groupes publics et privés découvrables', {
    tag: groupTag,
    response: { $ref: '#/components/schemas/GroupsResponse' }
});
add(p('api/groups'), 'post', 'Créer un groupe', {
    tag: groupTag,
    auth: true,
    body: 'CreateGroupRequest',
    success: 201,
    response: { $ref: '#/components/schemas/GroupEnvelope' }
});
add(p('api/groups/{groupId}'), 'get', 'Obtenir un groupe', {
    tag: groupTag,
    optionalAuth: true,
    response: { $ref: '#/components/schemas/GroupEnvelope' },
    extraResponses: { 404: standardErrors[404] }
});
add(p('api/groups/{groupId}'), 'patch', 'Modifier les paramètres d’un groupe', {
    tag: groupTag,
    auth: true,
    body: 'UpdateGroupRequest',
    response: { $ref: '#/components/schemas/GroupEnvelope' }
});
add(p('api/groups/{groupId}'), 'delete', 'Supprimer un groupe et ses adhésions', {
    tag: groupTag,
    auth: true,
    success: 204
});
add(p('api/groups/{groupId}/membership'), 'post', 'Rejoindre un groupe public ou demander à rejoindre un groupe privé', {
    tag: groupTag,
    auth: true,
    success: 201,
    response: { $ref: '#/components/schemas/MembershipEnvelope' },
    extraResponses: { 202: jsonResponse('Demande d’adhésion envoyée.', { $ref: '#/components/schemas/MembershipEnvelope' }) }
});
add(p('api/groups/{groupId}/invitations'), 'post', 'Inviter un utilisateur dans un groupe', {
    tag: groupTag,
    auth: true,
    body: 'UserIdRequest',
    success: 201,
    response: { $ref: '#/components/schemas/MembershipEnvelope' }
});
add(p('api/groups/{groupId}/invitations/accept'), 'post', 'Accepter une invitation de groupe', {
    tag: groupTag,
    auth: true,
    response: { $ref: '#/components/schemas/MembershipEnvelope' }
});
add(p('api/groups/{groupId}/invitations/decline'), 'post', 'Refuser une invitation de groupe', {
    tag: groupTag,
    auth: true,
    response: { $ref: '#/components/schemas/MembershipEnvelope' }
});
add(p('api/groups/{groupId}/members/{userId}/approve'), 'post', 'Approuver une demande d’adhésion', {
    tag: groupTag,
    auth: true,
    response: { $ref: '#/components/schemas/MembershipEnvelope' }
});
add(p('api/groups/{groupId}/members/{userId}/reject'), 'post', 'Refuser une demande d’adhésion', {
    tag: groupTag,
    auth: true,
    response: { $ref: '#/components/schemas/MembershipEnvelope' }
});
add(p('api/groups/{groupId}/members/{userId}/role'), 'patch', 'Modifier le rôle d’un membre', {
    tag: groupTag,
    auth: true,
    body: 'GroupRoleRequest',
    response: { $ref: '#/components/schemas/MembershipEnvelope' }
});
add(p('api/groups/{groupId}/members/{userId}'), 'delete', 'Retirer un membre ou quitter le groupe', {
    tag: groupTag,
    auth: true,
    success: 204
});
add(p('api/groups/{groupId}/members'), 'get', 'Lister les membres actifs', {
    tag: groupTag,
    auth: true,
    response: { $ref: '#/components/schemas/MembersResponse' }
});
add(p('api/groups/{groupId}/membership-requests'), 'get', 'Lister les demandes d’adhésion en attente', {
    tag: groupTag,
    auth: true,
    response: { $ref: '#/components/schemas/MembershipRequestsResponse' }
});
add(p('api/groups/{groupId}/membership/leave'), 'post', 'Quitter un groupe', {
    tag: groupTag,
    auth: true,
    success: 204
});

const eventTag = 'Événements';
add(p('api/events'), 'get', 'Lister les événements publics et les événements privés accessibles', {
    tag: eventTag,
    optionalAuth: true,
    response: { $ref: '#/components/schemas/EventsResponse' }
});
add(p('api/events'), 'post', 'Créer un événement', {
    tag: eventTag,
    auth: true,
    body: 'CreateEventRequest',
    success: 201,
    response: { $ref: '#/components/schemas/EventEnvelope' }
});
add(p('api/events/{eventId}'), 'get', 'Obtenir un événement', {
    tag: eventTag,
    optionalAuth: true,
    response: { $ref: '#/components/schemas/EventEnvelope' }
});
add(p('api/events/{eventId}'), 'patch', 'Modifier un événement', {
    tag: eventTag,
    auth: true,
    body: 'UpdateEventRequest',
    response: { $ref: '#/components/schemas/EventEnvelope' }
});
add(p('api/events/{eventId}'), 'delete', 'Supprimer un événement', {
    tag: eventTag,
    auth: true,
    success: 204,
    description: 'Supprime également ses participations, types de billets et billets associés.'
});
add(p('api/events/{eventId}/response'), 'post', 'Répondre à une invitation ou indiquer sa participation', {
    tag: eventTag,
    auth: true,
    body: 'EventResponseRequest',
    response: { $ref: '#/components/schemas/ParticipationEnvelope' }
});
add(p('api/events/{eventId}/invitations'), 'post', 'Inviter un utilisateur à un événement', {
    tag: eventTag,
    auth: true,
    body: 'UserIdRequest',
    success: 201,
    response: { $ref: '#/components/schemas/ParticipationEnvelope' }
});
add(p('api/events/{eventId}/participants'), 'get', 'Lister les participants ayant répondu positivement', {
    tag: eventTag,
    auth: true,
    response: { $ref: '#/components/schemas/ParticipantsResponse' }
});
add(p('api/events/{eventId}/participants/{userId}/role'), 'patch', 'Modifier le rôle d’un participant', {
    tag: eventTag,
    auth: true,
    body: 'EventRoleRequest',
    response: { $ref: '#/components/schemas/ParticipationEnvelope' }
});
add(p('api/events/{eventId}/participants/{userId}'), 'delete', 'Retirer un participant ou annuler sa participation', {
    tag: eventTag,
    auth: true,
    success: 204
});

const discussionTag = 'Discussions';
for (const resource of ['groups', 'events']) {
    const resourceId = resource === 'groups' ? 'groupId' : 'eventId';
    const resourceLabel = resource === 'groups' ? 'groupe' : 'événement';
    const base = `api/${resource}/{${resourceId}}/discussion/messages`;
    add(p(base), 'get', `Lister les messages du fil de ${resourceLabel}`, {
        tag: discussionTag,
        auth: true,
        query: [
            { name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, description: 'Nombre maximum de messages à renvoyer.' },
            { name: 'before', schema: { type: 'string', format: 'date-time' }, description: 'Ne renvoyer que les messages antérieurs à cette date.' }
        ],
        response: { $ref: '#/components/schemas/MessagesResponse' }
    });
    add(p(base), 'post', `Publier un message dans le fil de ${resourceLabel}`, {
        tag: discussionTag,
        auth: true,
        body: 'CreateMessageRequest',
        success: 201,
        response: { $ref: '#/components/schemas/MessageEnvelope' }
    });
    add(p(`${base}/{messageId}/replies`), 'post', `Répondre à un message du fil de ${resourceLabel}`, {
        tag: discussionTag,
        auth: true,
        body: 'CreateMessageRequest',
        success: 201,
        response: { $ref: '#/components/schemas/MessageEnvelope' },
        description: 'Les réponses imbriquées ne sont pas autorisées.'
    });
}

const albumTag = 'Albums photo';
add(p('api/events/{eventId}/albums'), 'get', 'Lister les albums d’un événement', {
    tag: albumTag,
    auth: true,
    response: { $ref: '#/components/schemas/AlbumsResponse' }
});
add(p('api/events/{eventId}/albums'), 'post', 'Créer un album', {
    tag: albumTag,
    auth: true,
    body: 'CreateAlbumRequest',
    success: 201,
    response: { $ref: '#/components/schemas/AlbumEnvelope' }
});
add(p('api/events/{eventId}/albums/{albumId}'), 'patch', 'Renommer un album', {
    tag: albumTag,
    auth: true,
    body: 'UpdateAlbumRequest',
    response: { $ref: '#/components/schemas/AlbumEnvelope' }
});
add(p('api/events/{eventId}/albums/{albumId}'), 'delete', 'Supprimer un album, ses photos et commentaires', {
    tag: albumTag,
    auth: true,
    success: 204
});
add(p('api/events/{eventId}/albums/{albumId}/photos'), 'get', 'Lister les photos d’un album', {
    tag: albumTag,
    auth: true,
    response: { $ref: '#/components/schemas/PhotosResponse' }
});
add(p('api/events/{eventId}/albums/{albumId}/photos'), 'post', 'Ajouter une photo par URL HTTPS', {
    tag: albumTag,
    auth: true,
    body: 'AddPhotoRequest',
    success: 201,
    response: { $ref: '#/components/schemas/PhotoEnvelope' }
});
add(p('api/events/{eventId}/albums/{albumId}/photos/{photoId}'), 'delete', 'Supprimer une photo et ses commentaires', {
    tag: albumTag,
    auth: true,
    success: 204
});
add(p('api/events/{eventId}/albums/{albumId}/photos/{photoId}/comments'), 'get', 'Lister les commentaires d’une photo', {
    tag: albumTag,
    auth: true,
    response: { $ref: '#/components/schemas/CommentsResponse' }
});
add(p('api/events/{eventId}/albums/{albumId}/photos/{photoId}/comments'), 'post', 'Commenter une photo', {
    tag: albumTag,
    auth: true,
    body: 'CreateCommentRequest',
    success: 201,
    response: { $ref: '#/components/schemas/CommentEnvelope' }
});
add(p('api/events/{eventId}/albums/{albumId}/photos/{photoId}/comments/{commentId}'), 'delete', 'Supprimer un commentaire', {
    tag: albumTag,
    auth: true,
    success: 204
});

const pollTag = 'Sondages';
add(p('api/events/{eventId}/polls'), 'get', 'Lister les sondages d’un événement', {
    tag: pollTag,
    auth: true,
    response: { $ref: '#/components/schemas/PollsResponse' }
});
add(p('api/events/{eventId}/polls'), 'post', 'Créer un sondage', {
    tag: pollTag,
    auth: true,
    body: 'CreatePollRequest',
    success: 201,
    response: { $ref: '#/components/schemas/PollEnvelope' }
});
add(p('api/events/{eventId}/polls/{pollId}'), 'get', 'Obtenir un sondage, les résultats et sa propre réponse', {
    tag: pollTag,
    auth: true,
    response: { $ref: '#/components/schemas/PollDetailsResponse' }
});
add(p('api/events/{eventId}/polls/{pollId}/response'), 'put', 'Répondre au sondage ou modifier sa réponse', {
    tag: pollTag,
    auth: true,
    body: 'PollResponseRequest',
    response: { $ref: '#/components/schemas/PollResponseEnvelope' },
    extraResponses: { 409: standardErrors[409] },
    description: 'Fournir exactement un choix pour chaque question. Une seule réponse par participant et par sondage.'
});
add(p('api/events/{eventId}/polls/{pollId}/close'), 'post', 'Clôturer un sondage', {
    tag: pollTag,
    auth: true,
    response: { $ref: '#/components/schemas/PollEnvelope' },
    extraResponses: { 409: standardErrors[409] }
});
add(p('api/events/{eventId}/polls/{pollId}'), 'delete', 'Supprimer un sondage et ses réponses', {
    tag: pollTag,
    auth: true,
    success: 204
});

const ticketTag = 'Billetterie';
add(p('api/events/{eventId}/ticket-types'), 'get', 'Lister les types de billets et les stocks disponibles', {
    tag: ticketTag,
    response: { $ref: '#/components/schemas/TicketTypesResponse' }
});
add(p('api/events/{eventId}/ticket-types'), 'post', 'Créer un type de billet pour un événement public', {
    tag: ticketTag,
    auth: true,
    body: 'CreateTicketTypeRequest',
    success: 201,
    response: { $ref: '#/components/schemas/TicketTypeEnvelope' }
});
add(p('api/events/{eventId}/ticket-types/{ticketTypeId}'), 'patch', 'Modifier un type de billet', {
    tag: ticketTag,
    auth: true,
    body: 'UpdateTicketTypeRequest',
    response: { $ref: '#/components/schemas/TicketTypeEnvelope' }
});
add(p('api/events/{eventId}/ticket-types/{ticketTypeId}'), 'delete', 'Supprimer un type de billet sans vente', {
    tag: ticketTag,
    auth: true,
    success: 204
});
add(p('api/events/{eventId}/tickets'), 'post', 'Obtenir un billet sans paiement intégré', {
    tag: ticketTag,
    body: 'PurchaseTicketRequest',
    success: 201,
    response: { $ref: '#/components/schemas/TicketEnvelope' },
    extraResponses: { 409: standardErrors[409] },
    description: 'Un billet par e-mail normalisé et par événement. Les prix sont en centimes EUR. Cette route ne prélève aucun paiement.'
});
add(p('api/events/{eventId}/tickets'), 'get', 'Lister les billets et coordonnées des acheteurs (organisateurs)', {
    tag: ticketTag,
    auth: true,
    response: { $ref: '#/components/schemas/TicketsResponse' }
});

const errorSchema = {
    type: 'object',
    required: ['error'],
    properties: {
        error: { type: 'string' },
        details: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    field: { type: 'string' },
                    message: { type: 'string' }
                }
            }
        }
    }
};

const schemas = {
    Message: {
        type: 'object',
        properties: { error: { type: 'string' }, status: { type: 'string' } }
    },
    ValidationError: errorSchema,
    RegisterRequest: {
        type: 'object',
        required: ['firstName', 'lastName', 'email', 'password'],
        additionalProperties: false,
        properties: {
            firstName: { type: 'string', minLength: 1, maxLength: 80 },
            lastName: { type: 'string', minLength: 1, maxLength: 80 },
            email: { type: 'string', format: 'email', maxLength: 254 },
            password: { type: 'string', minLength: 12, maxLength: 72, description: 'Maximum 72 octets UTF-8.' }
        }
    },
    LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1, maxLength: 72 }
        }
    },
    AuthResponse: {
        type: 'object',
        properties: {
            token: { type: 'string' },
            tokenType: { type: 'string', example: 'Bearer' },
            expiresIn: { type: 'integer', example: 3600 },
            user: { $ref: '#/components/schemas/User' }
        }
    },
    User: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            createdAt: { type: 'string', format: 'date-time' }
        }
    },
    UserEnvelope: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
    CreateGroupRequest: {
        type: 'object',
        required: ['name', 'description', 'visibility'],
        additionalProperties: false,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', minLength: 1, maxLength: 5000 },
            iconUrl: { type: 'string', format: 'uri', nullable: true },
            coverUrl: { type: 'string', format: 'uri', nullable: true },
            visibility: { type: 'string', enum: ['public', 'private', 'secret'] },
            memberCanPost: { type: 'boolean', default: false },
            memberCanCreateEvents: { type: 'boolean', default: false }
        }
    },
    UpdateGroupRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', minLength: 1, maxLength: 5000 },
            iconUrl: { type: 'string', format: 'uri', nullable: true },
            coverUrl: { type: 'string', format: 'uri', nullable: true },
            visibility: { type: 'string', enum: ['public', 'private', 'secret'] },
            memberCanPost: { type: 'boolean' },
            memberCanCreateEvents: { type: 'boolean' }
        }
    },
    Group: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            iconUrl: { type: 'string', format: 'uri', nullable: true },
            coverUrl: { type: 'string', format: 'uri', nullable: true },
            visibility: { type: 'string', enum: ['public', 'private', 'secret'] },
            memberCanPost: { type: 'boolean' },
            memberCanCreateEvents: { type: 'boolean' },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
        }
    },
    GroupEnvelope: { type: 'object', properties: { group: { $ref: '#/components/schemas/Group' } } },
    GroupsResponse: { type: 'object', properties: { groups: { type: 'array', items: { $ref: '#/components/schemas/Group' } } } },
    UserIdRequest: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: { userId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }
    },
    GroupRoleRequest: {
        type: 'object',
        required: ['role'],
        additionalProperties: false,
        properties: { role: { type: 'string', enum: ['member', 'admin'] } }
    },
    Membership: {
        type: 'object',
        properties: {
            groupId: { type: 'string' },
            userId: { type: 'string' },
            role: { type: 'string', enum: ['member', 'admin'] },
            status: { type: 'string', enum: ['pending', 'active', 'invited', 'rejected'] }
        }
    },
    MembershipEnvelope: { type: 'object', properties: { membership: { $ref: '#/components/schemas/Membership' } } },
    MembersResponse: { type: 'object', properties: { members: { type: 'array', items: { $ref: '#/components/schemas/Membership' } } } },
    MembershipRequestsResponse: { type: 'object', properties: { requests: { type: 'array', items: { type: 'object', properties: { userId: { type: 'string' }, requestedAt: { type: 'string', format: 'date-time' } } } } } },
    CreateEventRequest: {
        type: 'object',
        required: ['name', 'description', 'startAt', 'endAt', 'place', 'visibility'],
        additionalProperties: false,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', minLength: 1, maxLength: 10000 },
            startAt: { type: 'string', format: 'date-time' },
            endAt: { type: 'string', format: 'date-time', description: 'Doit être postérieure à startAt.' },
            place: { type: 'string', minLength: 1, maxLength: 500 },
            coverUrl: { type: 'string', format: 'uri', nullable: true },
            visibility: { type: 'string', enum: ['public', 'private'] },
            groupId: { type: 'string', nullable: true, pattern: '^[a-fA-F0-9]{24}$' }
        }
    },
    UpdateEventRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', minLength: 1, maxLength: 10000 },
            startAt: { type: 'string', format: 'date-time' },
            endAt: { type: 'string', format: 'date-time' },
            place: { type: 'string', minLength: 1, maxLength: 500 },
            coverUrl: { type: 'string', format: 'uri', nullable: true },
            visibility: { type: 'string', enum: ['public', 'private'] }
        }
    },
    Event: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            startAt: { type: 'string', format: 'date-time' },
            endAt: { type: 'string', format: 'date-time' },
            place: { type: 'string' },
            coverUrl: { type: 'string', format: 'uri', nullable: true },
            visibility: { type: 'string', enum: ['public', 'private'] },
            createdBy: { type: 'string' },
            groupId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
        }
    },
    EventEnvelope: { type: 'object', properties: { event: { $ref: '#/components/schemas/Event' } } },
    EventsResponse: { type: 'object', properties: { events: { type: 'array', items: { $ref: '#/components/schemas/Event' } } } },
    EventResponseRequest: {
        type: 'object',
        required: ['status'],
        additionalProperties: false,
        properties: { status: { type: 'string', enum: ['interested', 'going', 'declined'] } }
    },
    Participation: {
        type: 'object',
        properties: {
            eventId: { type: 'string' },
            userId: { type: 'string' },
            role: { type: 'string', enum: ['participant', 'organizer'] },
            status: { type: 'string', enum: ['invited', 'interested', 'going', 'declined'] },
            respondedAt: { type: 'string', format: 'date-time', nullable: true }
        }
    },
    ParticipationEnvelope: { type: 'object', properties: { participation: { $ref: '#/components/schemas/Participation' } } },
    EventRoleRequest: {
        type: 'object',
        required: ['role'],
        additionalProperties: false,
        properties: { role: { type: 'string', enum: ['participant', 'organizer'] } }
    },
    ParticipantsResponse: { type: 'object', properties: { participants: { type: 'array', items: { $ref: '#/components/schemas/Participation' } } } },
    CreateMessageRequest: {
        type: 'object',
        required: ['content'],
        additionalProperties: false,
        properties: { content: { type: 'string', minLength: 1, maxLength: 5000 } }
    },
    DiscussionMessage: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            threadId: { type: 'string' },
            authorId: { type: 'string' },
            content: { type: 'string' },
            replyTo: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
        }
    },
    MessageEnvelope: { type: 'object', properties: { message: { $ref: '#/components/schemas/DiscussionMessage' } } },
    MessagesResponse: {
        type: 'object',
        properties: {
            messages: { type: 'array', items: { $ref: '#/components/schemas/DiscussionMessage' } },
            hasMore: { type: 'boolean' },
            nextBefore: { type: 'string', format: 'date-time', nullable: true }
        }
    },
    CreateAlbumRequest: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: { name: { type: 'string', minLength: 1, maxLength: 120 } }
    },
    UpdateAlbumRequest: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: { name: { type: 'string', minLength: 1, maxLength: 120 } }
    },
    Album: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            eventId: { type: 'string' },
            name: { type: 'string' },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
        }
    },
    AlbumEnvelope: { type: 'object', properties: { album: { $ref: '#/components/schemas/Album' } } },
    AlbumsResponse: { type: 'object', properties: { albums: { type: 'array', items: { $ref: '#/components/schemas/Album' } } } },
    AddPhotoRequest: {
        type: 'object',
        required: ['imageUrl'],
        additionalProperties: false,
        properties: {
            imageUrl: { type: 'string', format: 'uri', maxLength: 2048, pattern: '^https://' },
            caption: { type: 'string', maxLength: 1000 },
            altText: { type: 'string', maxLength: 300 }
        }
    },
    Photo: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            eventId: { type: 'string' },
            albumId: { type: 'string' },
            uploadedBy: { type: 'string' },
            imageUrl: { type: 'string', format: 'uri' },
            caption: { type: 'string' },
            altText: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
        }
    },
    PhotoEnvelope: { type: 'object', properties: { photo: { $ref: '#/components/schemas/Photo' } } },
    PhotosResponse: { type: 'object', properties: { photos: { type: 'array', items: { $ref: '#/components/schemas/Photo' } } } },
    CreateCommentRequest: {
        type: 'object',
        required: ['content'],
        additionalProperties: false,
        properties: { content: { type: 'string', minLength: 1, maxLength: 2000 } }
    },
    Comment: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            photoId: { type: 'string' },
            authorId: { type: 'string' },
            content: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
        }
    },
    CommentEnvelope: { type: 'object', properties: { comment: { $ref: '#/components/schemas/Comment' } } },
    CommentsResponse: { type: 'object', properties: { comments: { type: 'array', items: { $ref: '#/components/schemas/Comment' } } } },
    CreatePollRequest: {
        type: 'object',
        required: ['title', 'questions'],
        additionalProperties: false,
        properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            questions: {
                type: 'array',
                minItems: 1,
                maxItems: 50,
                items: {
                    type: 'object',
                    required: ['text', 'options'],
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', minLength: 1, maxLength: 500 },
                        options: { type: 'array', minItems: 2, maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 200 } }
                    }
                }
            }
        }
    },
    PollResponseRequest: {
        type: 'object',
        required: ['answers'],
        additionalProperties: false,
        properties: {
            answers: {
                type: 'array',
                minItems: 1,
                maxItems: 50,
                items: {
                    type: 'object',
                    required: ['questionId', 'optionId'],
                    additionalProperties: false,
                    properties: {
                        questionId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
                        optionId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
                    }
                }
            }
        }
    },
    Poll: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            eventId: { type: 'string' },
            title: { type: 'string' },
            questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } } } } } } },
            status: { type: 'string', enum: ['open', 'closed'] },
            createdBy: { type: 'string' },
            closedAt: { type: 'string', format: 'date-time', nullable: true }
        }
    },
    PollEnvelope: { type: 'object', properties: { poll: { $ref: '#/components/schemas/Poll' } } },
    PollsResponse: { type: 'object', properties: { polls: { type: 'array', items: { $ref: '#/components/schemas/Poll' } } } },
    PollDetailsResponse: {
        type: 'object',
        properties: {
            poll: { $ref: '#/components/schemas/Poll' },
            results: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        questionId: { type: 'string' },
                        options: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    optionId: { type: 'string' },
                                    text: { type: 'string' },
                                    votes: { type: 'integer' }
                                }
                            }
                        }
                    }
                }
            },
            myResponse: {
                type: 'object',
                nullable: true,
                properties: {
                    answers: { type: 'array', items: { type: 'object' } },
                    updatedAt: { type: 'string', format: 'date-time' }
                }
            }
        }
    },
    PollResponseEnvelope: { type: 'object', properties: { response: { type: 'object', properties: { pollId: { type: 'string' }, userId: { type: 'string' }, answers: { type: 'array', items: { type: 'object' } }, updatedAt: { type: 'string', format: 'date-time' } } } } },
    CreateTicketTypeRequest: {
        type: 'object',
        required: ['name', 'priceCents', 'quantity'],
        additionalProperties: false,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            priceCents: { type: 'integer', minimum: 0, description: 'Prix en centimes d’euro.' },
            quantity: { type: 'integer', minimum: 1 }
        }
    },
    UpdateTicketTypeRequest: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            priceCents: { type: 'integer', minimum: 0 },
            quantity: { type: 'integer', minimum: 1 }
        }
    },
    TicketType: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            eventId: { type: 'string' },
            name: { type: 'string' },
            priceCents: { type: 'integer' },
            currency: { type: 'string', enum: ['EUR'] },
            quantity: { type: 'integer' },
            sold: { type: 'integer' },
            available: { type: 'integer' }
        }
    },
    TicketTypeEnvelope: { type: 'object', properties: { ticketType: { $ref: '#/components/schemas/TicketType' } } },
    TicketTypesResponse: { type: 'object', properties: { ticketTypes: { type: 'array', items: { $ref: '#/components/schemas/TicketType' } } } },
    PurchaseTicketRequest: {
        type: 'object',
        required: ['ticketTypeId', 'firstName', 'lastName', 'email', 'fullAddress'],
        additionalProperties: false,
        properties: {
            ticketTypeId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
            firstName: { type: 'string', minLength: 1, maxLength: 80 },
            lastName: { type: 'string', minLength: 1, maxLength: 80 },
            email: { type: 'string', format: 'email', maxLength: 254 },
            fullAddress: { type: 'string', minLength: 1, maxLength: 500 }
        }
    },
    Ticket: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            eventId: { type: 'string' },
            ticketTypeId: { type: 'string' },
            ticketTypeName: { type: 'string' },
            priceCents: { type: 'integer' },
            currency: { type: 'string', enum: ['EUR'] },
            buyer: { type: 'object', properties: { firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string', format: 'email' }, fullAddress: { type: 'string' } } },
            purchasedAt: { type: 'string', format: 'date-time' },
            paymentStatus: { type: 'string', enum: ['not_integrated'] }
        }
    },
    TicketEnvelope: { type: 'object', properties: { ticket: { $ref: '#/components/schemas/Ticket' } } },
    TicketsResponse: { type: 'object', properties: { tickets: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } } } }
};

export default {
    openapi: '3.0.3',
    info: {
        title: 'Social Network API',
        version: '1.0.0',
        description: [
            'Documentation OpenAPI de l’API des groupes, événements et fonctionnalités associées.',
            '',
            'Les routes protégées utilisent un jeton JWT obtenu via l’inscription ou la connexion.',
            'Dans Swagger UI, cliquer sur Authorize et saisir le jeton seul (sans préfixe Bearer).',
            '',
            'Les images sont fournies par URL HTTPS ; aucun fichier image n’est envoyé à l’API.',
            'La billetterie enregistre un billet mais ne réalise aucun paiement.'
        ].join('\n')
    },
    servers: [{ url: '/', description: 'Serveur courant' }],
    tags: [
        { name: authTag, description: 'Création de compte, connexion et profil.' },
        { name: groupTag, description: 'Groupes, adhésions, invitations et rôles.' },
        { name: eventTag, description: 'Événements, invitations et participations.' },
        { name: discussionTag, description: 'Messages et réponses des discussions.' },
        { name: albumTag, description: 'Albums, photos et commentaires d’événements.' },
        { name: pollTag, description: 'Sondages des événements et leurs réponses.' },
        { name: ticketTag, description: 'Types de billets et enregistrement des billets.' }
    ],
    paths,
    components: {
        securitySchemes: {
            BearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Jeton JWT retourné par `/api/auth/register` ou `/api/auth/login`.'
            }
        },
        schemas
    }
};
