import mongoose from 'mongoose';

const eventParticipationSchema = new mongoose.Schema({
    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Event'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    role: {
        type: String,
        enum: ['participant', 'organizer'],
        required: true,
        default: 'participant'
    },
    status: {
        type: String,
        enum: ['invited', 'interested', 'going', 'declined'],
        required: true
    },
    respondedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    versionKey: false
});

eventParticipationSchema.index({ eventId: 1, userId: 1 }, { unique: true });
eventParticipationSchema.index({ eventId: 1, status: 1, role: 1 });
eventParticipationSchema.index({ userId: 1, status: 1 });

export default function getEventParticipationModel(connection) {
    return connection.models.EventParticipation
        || connection.model('EventParticipation', eventParticipationSchema);
}
