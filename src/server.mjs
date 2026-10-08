import express from 'express';
import mongoose from 'mongoose';

import config from './config.mjs';
import getUserModel from './models/user.mjs';
import createAuthRouter from './routes/auth.mjs';
import createUsersRouter from './routes/users.mjs';

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

    middleware(User) {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use('/api/auth', createAuthRouter({
            User,
            jwtSecret: this.config.jwtSecret
        }));
        this.app.use('/api/users', createUsersRouter({
            User,
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
        await User.init();
        this.middleware(User);

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
