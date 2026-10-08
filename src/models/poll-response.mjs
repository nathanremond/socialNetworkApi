import mongoose from 'mongoose';

const pollAnswerSchema = new mongoose.Schema({
    questionId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    optionId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    }
}, {
    _id: false
});

const pollResponseSchema = new mongoose.Schema({
    pollId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'EventPoll'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    answers: {
        type: [pollAnswerSchema],
        required: true
    }
}, {
    timestamps: true,
    versionKey: false
});

pollResponseSchema.index({ pollId: 1, userId: 1 }, { unique: true });
pollResponseSchema.index({ pollId: 1, updatedAt: -1 });

export default function getPollResponseModel(connection) {
    return connection.models.PollResponse || connection.model('PollResponse', pollResponseSchema);
}
