import mongoose from 'mongoose';

const eventPhotoSchema = new mongoose.Schema({
    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Event'
    },
    albumId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'EventAlbum'
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    imageUrl: {
        type: String,
        required: true,
        maxlength: 2048
    },
    caption: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: ''
    },
    altText: {
        type: String,
        trim: true,
        maxlength: 300,
        default: ''
    }
}, {
    timestamps: true,
    versionKey: false
});

eventPhotoSchema.index({ albumId: 1, createdAt: -1 });
eventPhotoSchema.index({ eventId: 1, createdAt: -1 });

export default function getEventPhotoModel(connection) {
    return connection.models.EventPhoto || connection.model('EventPhoto', eventPhotoSchema);
}
