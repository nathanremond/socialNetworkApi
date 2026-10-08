import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import requireAuth from '../middleware/require-auth.mjs';

const createAlbumSchema = z.object({
    name: z.string().trim().min(1).max(120)
}).strict();

const updateAlbumSchema = createAlbumSchema.partial().refine((data) => Object.keys(data).length > 0);

const addPhotoSchema = z.object({
    imageUrl: z.url().max(2048).refine((value) => value.startsWith('https://'), {
        message: 'Photo URL must use HTTPS'
    }),
    caption: z.string().trim().max(1000).optional(),
    altText: z.string().trim().max(300).optional()
}).strict();

const commentSchema = z.object({
    content: z.string().trim().min(1).max(2000)
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

function serializeAlbum(album) {
    return {
        id: album.id,
        eventId: album.eventId,
        name: album.name,
        createdBy: album.createdBy,
        createdAt: album.createdAt,
        updatedAt: album.updatedAt
    };
}

function serializePhoto(photo) {
    return {
        id: photo.id,
        eventId: photo.eventId,
        albumId: photo.albumId,
        uploadedBy: photo.uploadedBy,
        imageUrl: photo.imageUrl,
        caption: photo.caption,
        altText: photo.altText,
        createdAt: photo.createdAt,
        updatedAt: photo.updatedAt
    };
}

function serializeComment(comment) {
    return {
        id: comment.id,
        photoId: comment.photoId,
        authorId: comment.authorId,
        content: comment.content,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt
    };
}

export default function createEventAlbumsRouter({
    Event,
    EventParticipation,
    EventAlbum,
    EventPhoto,
    PhotoComment,
    jwtSecret
}) {
    const router = Router();
    const authenticate = requireAuth(jwtSecret);

    async function loadEvent(req, res, next) {
        if (!mongoose.isValidObjectId(req.params.eventId)) {
            return res.status(404).json({ error: 'Event not found' });
        }
        req.event = await Event.findById(req.params.eventId);
        if (!req.event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        return next();
    }

    async function requireConfirmedParticipation(req, res, next) {
        req.eventParticipation = await EventParticipation.findOne({
            eventId: req.event.id,
            userId: req.authUserId,
            role: { $in: ['participant', 'organizer'] },
            status: 'going'
        });
        if (!req.eventParticipation) {
            return res.status(403).json({ error: 'Confirmed event participation required' });
        }
        return next();
    }

    async function requireOrganizer(req, res, next) {
        if (req.eventParticipation.role !== 'organizer') {
            return res.status(403).json({ error: 'Event organizer permission required' });
        }
        return next();
    }

    async function loadAlbum(req, res, next) {
        if (!mongoose.isValidObjectId(req.params.albumId)) {
            return res.status(404).json({ error: 'Album not found' });
        }
        req.album = await EventAlbum.findOne({
            _id: req.params.albumId,
            eventId: req.event.id
        });
        if (!req.album) {
            return res.status(404).json({ error: 'Album not found' });
        }
        return next();
    }

    async function loadPhoto(req, res, next) {
        if (!mongoose.isValidObjectId(req.params.photoId)) {
            return res.status(404).json({ error: 'Photo not found' });
        }
        req.photo = await EventPhoto.findOne({
            _id: req.params.photoId,
            albumId: req.album.id,
            eventId: req.event.id
        });
        if (!req.photo) {
            return res.status(404).json({ error: 'Photo not found' });
        }
        return next();
    }

    router.get(
        '/:eventId/albums',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        async (req, res) => {
            const albums = await EventAlbum.find({ eventId: req.event.id })
                .sort({ createdAt: -1 });
            return res.status(200).json({ albums: albums.map(serializeAlbum) });
        }
    );

    router.post(
        '/:eventId/albums',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        requireOrganizer,
        async (req, res) => {
            const parsed = createAlbumSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }
            const album = await EventAlbum.create({
                eventId: req.event.id,
                name: parsed.data.name,
                createdBy: req.authUserId
            });
            return res.status(201).json({ album: serializeAlbum(album) });
        }
    );

    router.patch(
        '/:eventId/albums/:albumId',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        requireOrganizer,
        loadAlbum,
        async (req, res) => {
            const parsed = updateAlbumSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }
            Object.assign(req.album, parsed.data);
            await req.album.save();
            return res.status(200).json({ album: serializeAlbum(req.album) });
        }
    );

    router.delete(
        '/:eventId/albums/:albumId',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        requireOrganizer,
        loadAlbum,
        async (req, res) => {
            const photos = await EventPhoto.find({ albumId: req.album.id }).select('_id');
            const photoIds = photos.map(({ id }) => id);
            if (photoIds.length > 0) {
                await PhotoComment.deleteMany({ photoId: { $in: photoIds } });
            }
            await EventPhoto.deleteMany({ albumId: req.album.id });
            await req.album.deleteOne();
            return res.status(204).end();
        }
    );

    router.get(
        '/:eventId/albums/:albumId/photos',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadAlbum,
        async (req, res) => {
            const photos = await EventPhoto.find({ albumId: req.album.id })
                .sort({ createdAt: -1 });
            return res.status(200).json({ photos: photos.map(serializePhoto) });
        }
    );

    router.post(
        '/:eventId/albums/:albumId/photos',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadAlbum,
        async (req, res) => {
            const parsed = addPhotoSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }
            const photo = await EventPhoto.create({
                eventId: req.event.id,
                albumId: req.album.id,
                uploadedBy: req.authUserId,
                imageUrl: parsed.data.imageUrl,
                caption: parsed.data.caption ?? '',
                altText: parsed.data.altText ?? ''
            });
            return res.status(201).json({ photo: serializePhoto(photo) });
        }
    );

    router.delete(
        '/:eventId/albums/:albumId/photos/:photoId',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadAlbum,
        loadPhoto,
        async (req, res) => {
            const isOrganizer = req.eventParticipation.role === 'organizer';
            const isUploader = String(req.photo.uploadedBy) === req.authUserId;
            if (!isOrganizer && !isUploader) {
                return res.status(403).json({ error: 'Only the uploader or an event organizer can delete this photo' });
            }

            await PhotoComment.deleteMany({ photoId: req.photo.id });
            await req.photo.deleteOne();
            return res.status(204).end();
        }
    );

    router.get(
        '/:eventId/albums/:albumId/photos/:photoId/comments',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadAlbum,
        loadPhoto,
        async (req, res) => {
            const comments = await PhotoComment.find({ photoId: req.photo.id })
                .sort({ createdAt: 1 });
            return res.status(200).json({ comments: comments.map(serializeComment) });
        }
    );

    router.post(
        '/:eventId/albums/:albumId/photos/:photoId/comments',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadAlbum,
        loadPhoto,
        async (req, res) => {
            const parsed = commentSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }
            const comment = await PhotoComment.create({
                photoId: req.photo.id,
                authorId: req.authUserId,
                content: parsed.data.content
            });
            return res.status(201).json({ comment: serializeComment(comment) });
        }
    );

    router.delete(
        '/:eventId/albums/:albumId/photos/:photoId/comments/:commentId',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadAlbum,
        loadPhoto,
        async (req, res) => {
            if (!mongoose.isValidObjectId(req.params.commentId)) {
                return res.status(404).json({ error: 'Comment not found' });
            }
            const comment = await PhotoComment.findOne({
                _id: req.params.commentId,
                photoId: req.photo.id
            });
            if (!comment) {
                return res.status(404).json({ error: 'Comment not found' });
            }

            const isOrganizer = req.eventParticipation.role === 'organizer';
            const isAuthor = String(comment.authorId) === req.authUserId;
            if (!isOrganizer && !isAuthor) {
                return res.status(403).json({ error: 'Only the author or an event organizer can delete this comment' });
            }

            await comment.deleteOne();
            return res.status(204).end();
        }
    );

    return router;
}
