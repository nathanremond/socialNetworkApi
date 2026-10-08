import express from 'express';
import mongoose from 'mongoose';

import config from './config.mjs';

const Server  = class Server{
    constructor(){
        this.app = express();
        this.config = config[process.argv[2]] || config.development;
    }

    async dbConnect() {
        try {
            const host = this.config.mongodb;

            this.connect = await mongoose.createConnection(host, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });

            const close = () => {
                this.connect.close((error) => {
                    if (error) {
                        console.error('[ERROR] api dbConnect() close() -> mongodb error', error);
                    } else {
                        console.log('[CLOSE] api dbConnect() close() -> mongodb closed');
                    }
                })
            }

            this.connect.on('connected', () =>{
                console.log('api connectée')
            });

            this.connect.on('error', (err) =>{
                setTimeout(() => {
                    console.log('[ERROR] api dbConnect() -> mongodb error')
                    this.connect = this.dbConnect();
                }, 5000);
            });

            this.connect.on('disconnected', (err) =>{
                setTimeout(() => {
                    console.log('[ERROR] api dbConnect() -> mongodb disconnected')
                    this.connect = this.dbConnect();
                }, 5000);
            });

            process.on('SIGINT', () => {
                close();
                process.exit(0);
            });
        } catch (err) {
            console.error(`[ERROR] api dbConnect() -> ${err}`);
        }
    }

    middleware(){
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
    }
    
    async run(){
        try {
            await this.dbConnect();
            this.middleware();
            this.app.listen(3000);
        } catch (err) {
            console.log(err);
        }
        
    }
};

export default Server