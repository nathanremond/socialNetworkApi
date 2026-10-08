import jwt from 'jsonwebtoken';

function authenticateRequest(jwtSecret, required) {
    return (req, res, next) => {
        const authorization = req.get('authorization');
        const match = authorization?.match(/^Bearer\s+(.+)$/i);

        if (!match) {
            return required
                ? res.status(401).json({ error: 'Authentication required' })
                : next();
        }

        try {
            const payload = jwt.verify(match[1], jwtSecret, {
                issuer: 'social-network-api',
                audience: 'social-network-api'
            });

            if (typeof payload === 'string' || typeof payload.sub !== 'string') {
                return res.status(401).json({ error: 'Invalid or expired token' });
            }

            req.authUserId = payload.sub;
            return next();
        } catch {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    };
}

export function optionalAuth(jwtSecret) {
    return authenticateRequest(jwtSecret, false);
}

export default function requireAuth(jwtSecret) {
    return authenticateRequest(jwtSecret, true);
}
