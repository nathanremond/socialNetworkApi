import { Router } from 'express';

import requireAuth from '../middleware/require-auth.mjs';

export default function createUsersRouter({ User, jwtSecret }) {
    const router = Router();
    router.use(requireAuth(jwtSecret));

    router.get('/me', async (req, res) => {
        const user = await User.findById(req.authUserId);
        if (!user) {
            return res.status(401).json({ error: 'User account no longer exists' });
        }

        return res.status(200).json({
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                createdAt: user.createdAt
            }
        });
    });

    return router;
}
