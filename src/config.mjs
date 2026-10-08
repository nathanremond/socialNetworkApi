const port = Number(process.env.PORT || 3000);
const mongodb = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;

export default {
    development: {
        type: 'development',
        port,
        mongodb,
        jwtSecret
    },
    production: {
        type: 'production',
        port,
        mongodb,
        jwtSecret
    }
};
