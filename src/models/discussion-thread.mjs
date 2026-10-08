import mongoose from 'mongoose';

const discussionThreadSchema = new mongoose.Schema({
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        default: null
    },
    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Event',
        default: null
    }
}, {
    timestamps: true,
    versionKey: false
});

discussionThreadSchema.pre('validate', function validateParent(next) {
    if (Boolean(this.groupId) === Boolean(this.eventId)) {
        this.invalidate('groupId', 'A discussion must belong to exactly one group or event');
        this.invalidate('eventId', 'A discussion must belong to exactly one group or event');
    }
    next();
});

discussionThreadSchema.index(
    { groupId: 1 },
    { unique: true, partialFilterExpression: { groupId: { $type: 'objectId' } } }
);
discussionThreadSchema.index(
    { eventId: 1 },
    { unique: true, partialFilterExpression: { eventId: { $type: 'objectId' } } }
);

export default function getDiscussionThreadModel(connection) {
    return connection.models.DiscussionThread
        || connection.model('DiscussionThread', discussionThreadSchema);
}
