import mongoose from 'mongoose';

const pollOptionSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    }
}, {
    _id: true
});

const pollQuestionSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    options: {
        type: [pollOptionSchema],
        required: true,
        validate: {
            validator: (options) => options.length >= 2,
            message: 'Each question must have at least two options'
        }
    }
}, {
    _id: true
});

const eventPollSchema = new mongoose.Schema({
    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Event'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    questions: {
        type: [pollQuestionSchema],
        required: true,
        validate: {
            validator: (questions) => questions.length >= 1,
            message: 'A poll must contain at least one question'
        }
    },
    status: {
        type: String,
        enum: ['open', 'closed'],
        default: 'open',
        required: true
    },
    closedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    versionKey: false
});

eventPollSchema.index({ eventId: 1, createdAt: -1 });

export default function getEventPollModel(connection) {
    return connection.models.EventPoll || connection.model('EventPoll', eventPollSchema);
}
