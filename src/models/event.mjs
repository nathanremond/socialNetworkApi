import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150
    },
    description: {
        type: String,
        required: true,
        trim: true,
        maxlength: 10000
    },
    startAt: {
        type: Date,
        required: true
    },
    endAt: {
        type: Date,
        required: true
    },
    place: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    coverUrl: {
        type: String,
        default: null
    },
    visibility: {
        type: String,
        enum: ['public', 'private'],
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        default: null
    }
}, {
    timestamps: true,
    versionKey: false
});

eventSchema.index({ visibility: 1, startAt: 1 });
eventSchema.index({ groupId: 1, startAt: 1 });

export default function getEventModel(connection) {
    return connection.models.Event || connection.model('Event', eventSchema);
}
