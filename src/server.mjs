import express from 'express';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';

import config from './config.mjs';
import getDiscussionMessageModel from './models/discussion-message.mjs';
import getDiscussionThreadModel from './models/discussion-thread.mjs';
import getEventAlbumModel from './models/event-album.mjs';
import getEventModel from './models/event.mjs';
import getEventPhotoModel from './models/event-photo.mjs';
import getEventParticipationModel from './models/event-participation.mjs';
import getGroupModel from './models/group.mjs';
import getGroupMembershipModel from './models/group-membership.mjs';
import getPhotoCommentModel from './models/photo-comment.mjs';
import getEventPollModel from './models/event-poll.mjs';
import getEventTicketModel from './models/event-ticket.mjs';
import getEventTicketTypeModel from './models/event-ticket-type.mjs';
import getPollResponseModel from './models/poll-response.mjs';
import getUserModel from './models/user.mjs';
import createAuthRouter from './routes/auth.mjs';
import createDiscussionRouter from './routes/discussion.mjs';
import createEventAlbumsRouter from './routes/event-albums.mjs';
import createEventPollsRouter from './routes/event-polls.mjs';
import createEventTicketsRouter from './routes/event-tickets.mjs';
import createEventsRouter from './routes/events.mjs';
import createGroupsRouter from './routes/groups.mjs';
import createUsersRouter from './routes/users.mjs';
import openApiDocument from './docs/openapi.mjs';

const Server = class Server {
    constructor() {
        this.app = express();
        this.config = config[process.env.NODE_ENV] || config[process.argv[2]] || config.development;
    }

    async dbConnect() {
        if (!this.config.mongodb) {
            throw new Error('MONGODB_URI is required');
        }

        const connection = mongoose.createConnection(this.config.mongodb);
        connection.on('error', (error) => {
            console.error('[ERROR] api dbConnect() -> mongodb error', error);
        });

        try {
            await connection.asPromise();
        } catch (error) {
            try {
                await connection.close();
            } catch (closeError) {
                console.error('[ERROR] api dbConnect() close() -> mongodb error', closeError);
            }
            throw error;
        }

        this.connect = connection;
        console.log('MongoDB connected');
    }

    middleware({
        User,
        Group,
        GroupMembership,
        Event,
        EventParticipation,
        DiscussionThread,
        DiscussionMessage,
        EventAlbum,
        EventPhoto,
        PhotoComment,
        EventPoll,
        PollResponse,
        EventTicketType,
        EventTicket
    }) {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
            explorer: true,
            swaggerOptions: {
                persistAuthorization: true
            }
        }));
        this.app.use('/api/auth', createAuthRouter({
            User,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/users', createUsersRouter({
            User,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/groups', createGroupsRouter({
            Group,
            GroupMembership,
            User,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/groups', createDiscussionRouter({
            context: 'group',
            Group,
            GroupMembership,
            DiscussionThread,
            DiscussionMessage,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/events', createEventsRouter({
            Event,
            EventParticipation,
            EventTicketType,
            EventTicket,
            Group,
            GroupMembership,
            User,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/events', createDiscussionRouter({
            context: 'event',
            Event,
            EventParticipation,
            DiscussionThread,
            DiscussionMessage,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/events', createEventAlbumsRouter({
            Event,
            EventParticipation,
            EventAlbum,
            EventPhoto,
            PhotoComment,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/events', createEventPollsRouter({
            Event,
            EventParticipation,
            EventPoll,
            PollResponse,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/events', createEventTicketsRouter({
            Event,
            EventParticipation,
            EventTicketType,
            EventTicket,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use((error, req, res, next) => {
            console.error('[ERROR] api request ->', error);
            const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
                ? error.status
                : 500;
            return res.status(status).json({
                error: status === 500 ? 'Internal server error' : 'Invalid request'
            });
        });
    }

    async run() {
        if (!this.config.jwtSecret || Buffer.byteLength(this.config.jwtSecret) < 32) {
            throw new Error('JWT_SECRET must contain at least 32 bytes');
        }

        await this.dbConnect();
        const User = getUserModel(this.connect);
        const Group = getGroupModel(this.connect);
        const GroupMembership = getGroupMembershipModel(this.connect);
        const Event = getEventModel(this.connect);
        const EventParticipation = getEventParticipationModel(this.connect);
        const DiscussionThread = getDiscussionThreadModel(this.connect);
        const DiscussionMessage = getDiscussionMessageModel(this.connect);
        const EventAlbum = getEventAlbumModel(this.connect);
        const EventPhoto = getEventPhotoModel(this.connect);
        const PhotoComment = getPhotoCommentModel(this.connect);
        const EventPoll = getEventPollModel(this.connect);
        const PollResponse = getPollResponseModel(this.connect);
        const EventTicketType = getEventTicketTypeModel(this.connect);
        const EventTicket = getEventTicketModel(this.connect);
        await Promise.all([
            User.init(),
            Group.init(),
            GroupMembership.init(),
            Event.init(),
            EventParticipation.init(),
            DiscussionThread.init(),
            DiscussionMessage.init(),
            EventAlbum.init(),
            EventPhoto.init(),
            PhotoComment.init(),
            EventPoll.init(),
            PollResponse.init(),
            EventTicketType.init(),
            EventTicket.init()
        ]);
        this.middleware({
            User,
            Group,
            GroupMembership,
            Event,
            EventParticipation,
            DiscussionThread,
            DiscussionMessage,
            EventAlbum,
            EventPhoto,
            PhotoComment,
            EventPoll,
            PollResponse,
            EventTicketType,
            EventTicket
        });

        this.httpServer = this.app.listen(this.config.port, () => {
            console.log(`API listening on port ${this.config.port}`);
        });

        process.once('SIGINT', async () => {
            await new Promise((resolve, reject) => {
                this.httpServer.close((error) => error ? reject(error) : resolve());
            });
            await this.connect.close();
            process.exit(0);
        });
    }
};

export default Server;
