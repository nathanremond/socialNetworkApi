import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const passwordSchema = z.string()
    .min(12)
    .max(72)
    .refine((password) => Buffer.byteLength(password, 'utf8') <= 72);

const registerSchema = z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().max(254).pipe(z.email()),
    password: passwordSchema
}).strict();

const loginSchema = z.object({
    email: z.string().trim().max(254).pipe(z.email()),
    password: z.string().min(1).max(72)
}).strict();

function validationError(res, error) {
    return res.status(400).json({
        error: 'Invalid request',
        details: error.issues.map(({ path, message }) => ({
            field: path.join('.'),
            message
        }))
    });
}

function publicUser(user) {
    return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        createdAt: user.createdAt
    };
}

function issueToken(userId, jwtSecret) {
    return jwt.sign({}, jwtSecret, {
        subject: userId,
        expiresIn: '1h',
        issuer: 'social-network-api',
        audience: 'social-network-api'
    });
}

export default function createAuthRouter({ User, jwtSecret }) {
    const router = Router();

    router.post('/register', async (req, res) => {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const { firstName, lastName, email, password } = parsed.data;

        try {
            const passwordHash = await bcrypt.hash(password, 12);
            const user = await User.create({
                firstName,
                lastName,
                email: email.toLowerCase(),
                passwordHash
            });

            return res.status(201).json({
                token: issueToken(user.id, jwtSecret),
                tokenType: 'Bearer',
                expiresIn: 3600,
                user: publicUser(user)
            });
        } catch (error) {
            if (error.code === 11000 && error.keyPattern?.email) {
                return res.status(409).json({ error: 'An account with this email already exists' });
            }
            throw error;
        }
    });

    router.post('/login', async (req, res) => {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error);
        }

        const email = parsed.data.email.toLowerCase();
        const user = await User.findOne({ email }).select('+passwordHash');
        const passwordMatches = user
            ? await bcrypt.compare(parsed.data.password, user.passwordHash)
            : false;

        if (!passwordMatches) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        return res.status(200).json({
            token: issueToken(user.id, jwtSecret),
            tokenType: 'Bearer',
            expiresIn: 3600,
            user: publicUser(user)
        });
    });

    return router;
}
