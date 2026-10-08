import mongoose from 'mongoose';

const discussionMessageSchema = new mongoose.Schema({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'DiscussionThread'
    },
    authorId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    content: {
        type: String,
        required: true,
        trim: true,
        maxlength: 5000
    },
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DiscussionMessage',
        default: null
    }
}, {
    timestamps: true,
    versionKey: false
});

discussionMessageSchema.index({ threadId: 1, createdAt: -1 });
discussionMessageSchema.index({ replyTo: 1, createdAt: 1 });

export default function getDiscussionMessageModel(connection) {
    return connection.models.DiscussionMessage
        || connection.model('DiscussionMessage', discussionMessageSchema);
}
