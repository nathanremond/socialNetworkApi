import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import requireAuth from '../middleware/require-auth.mjs';

const createPollSchema = z.object({
    title: z.string().trim().min(1).max(200),
    questions: z.array(z.object({
        text: z.string().trim().min(1).max(500),
        options: z.array(z.string().trim().min(1).max(200))
            .min(2)
            .max(20)
            .refine((options) => new Set(options.map((option) => option.toLocaleLowerCase())).size === options.length, {
                message: 'Options in a question must be unique'
            })
    }).strict()).min(1).max(50)
}).strict();

const answersSchema = z.object({
    answers: z.array(z.object({
        questionId: z.string().refine((value) => mongoose.isValidObjectId(value)),
        optionId: z.string().refine((value) => mongoose.isValidObjectId(value))
    }).strict()).min(1).max(50)
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

function serializePoll(poll) {
    return {
        id: poll.id,
        eventId: poll.eventId,
        title: poll.title,
        questions: poll.questions.map((question) => ({
            id: question.id,
            text: question.text,
            options: question.options.map((option) => ({
                id: option.id,
                text: option.text
            }))
        })),
        status: poll.status,
        createdBy: poll.createdBy,
        closedAt: poll.closedAt,
        createdAt: poll.createdAt,
        updatedAt: poll.updatedAt
    };
}

function serializeResults(poll, responses) {
    return poll.questions.map((question) => {
        const counts = new Map(question.options.map((option) => [String(option.id), 0]));

        for (const response of responses) {
            const answer = response.answers.find(
                (item) => String(item.questionId) === String(question.id)
            );
            if (answer && counts.has(String(answer.optionId))) {
                counts.set(String(answer.optionId), counts.get(String(answer.optionId)) + 1);
            }
        }

        return {
            questionId: question.id,
            options: question.options.map((option) => ({
                optionId: option.id,
                text: option.text,
                votes: counts.get(String(option.id))
            }))
        };
    });
}

export default function createEventPollsRouter({
    Event,
    EventParticipation,
    EventPoll,
    PollResponse,
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

    async function loadPoll(req, res, next) {
        if (!mongoose.isValidObjectId(req.params.pollId)) {
            return res.status(404).json({ error: 'Poll not found' });
        }
        req.poll = await EventPoll.findOne({
            _id: req.params.pollId,
            eventId: req.event.id
        });
        if (!req.poll) {
            return res.status(404).json({ error: 'Poll not found' });
        }
        return next();
    }

    router.get(
        '/:eventId/polls',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        async (req, res) => {
            const polls = await EventPoll.find({ eventId: req.event.id }).sort({ createdAt: -1 });
            return res.status(200).json({ polls: polls.map(serializePoll) });
        }
    );

    router.post(
        '/:eventId/polls',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        requireOrganizer,
        async (req, res) => {
            const parsed = createPollSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }
            const poll = await EventPoll.create({
                eventId: req.event.id,
                createdBy: req.authUserId,
                title: parsed.data.title,
                questions: parsed.data.questions.map((question) => ({
                    text: question.text,
                    options: question.options.map((text) => ({ text }))
                })),
                status: 'open'
            });
            return res.status(201).json({ poll: serializePoll(poll) });
        }
    );

    router.get(
        '/:eventId/polls/:pollId',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadPoll,
        async (req, res) => {
            const responses = await PollResponse.find({ pollId: req.poll.id }).select('answers');
            const myResponse = await PollResponse.findOne({
                pollId: req.poll.id,
                userId: req.authUserId
            }).select('answers updatedAt');
            return res.status(200).json({
                poll: serializePoll(req.poll),
                results: serializeResults(req.poll, responses),
                myResponse: myResponse
                    ? {
                        answers: myResponse.answers,
                        updatedAt: myResponse.updatedAt
                    }
                    : null
            });
        }
    );

    router.put(
        '/:eventId/polls/:pollId/response',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        loadPoll,
        async (req, res) => {
            if (req.poll.status !== 'open') {
                return res.status(409).json({ error: 'Poll is closed' });
            }
            const parsed = answersSchema.safeParse(req.body);
            if (!parsed.success) {
                return validationError(res, parsed.error);
            }

            const answers = parsed.data.answers;
            const questionIds = answers.map(({ questionId }) => questionId);
            if (new Set(questionIds).size !== questionIds.length) {
                return res.status(400).json({ error: 'Provide exactly one answer for each question' });
            }
            if (answers.length !== req.poll.questions.length) {
                return res.status(400).json({ error: 'Provide exactly one answer for each question' });
            }

            const questionsById = new Map(
                req.poll.questions.map((question) => [String(question.id), question])
            );
            const validAnswers = answers.every(({ questionId, optionId }) => {
                const question = questionsById.get(questionId);
                return question
                    && question.options.some((option) => String(option.id) === optionId);
            });
            if (!validAnswers) {
                return res.status(400).json({ error: 'Each answer must reference an option belonging to its question' });
            }

            let response;
            try {
                response = await PollResponse.findOneAndUpdate(
                    { pollId: req.poll.id, userId: req.authUserId },
                    { $set: { answers } },
                    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
                );
            } catch (error) {
                if (error.code === 11000) {
                    return res.status(409).json({ error: 'Poll response already exists; retry your update' });
                }
                throw error;
            }

            return res.status(200).json({
                response: {
                    pollId: response.pollId,
                    userId: response.userId,
                    answers: response.answers,
                    updatedAt: response.updatedAt
                }
            });
        }
    );

    router.post(
        '/:eventId/polls/:pollId/close',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        requireOrganizer,
        loadPoll,
        async (req, res) => {
            if (req.poll.status === 'closed') {
                return res.status(409).json({ error: 'Poll is already closed' });
            }
            req.poll.status = 'closed';
            req.poll.closedAt = new Date();
            await req.poll.save();
            return res.status(200).json({ poll: serializePoll(req.poll) });
        }
    );

    router.delete(
        '/:eventId/polls/:pollId',
        authenticate,
        loadEvent,
        requireConfirmedParticipation,
        requireOrganizer,
        loadPoll,
        async (req, res) => {
            await PollResponse.deleteMany({ pollId: req.poll.id });
            await req.poll.deleteOne();
            return res.status(204).end();
        }
    );

    return router;
}
