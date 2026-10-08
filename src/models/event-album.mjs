import mongoose from 'mongoose';

const eventAlbumSchema = new mongoose.Schema({
    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Event'
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    }
}, {
    timestamps: true,
    versionKey: false
});

eventAlbumSchema.index({ eventId: 1, createdAt: -1 });

export default function getEventAlbumModel(connection) {
    return connection.models.EventAlbum || connection.model('EventAlbum', eventAlbumSchema);
}
