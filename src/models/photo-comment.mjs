import mongoose from 'mongoose';

const photoCommentSchema = new mongoose.Schema({
    photoId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'EventPhoto'
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
        maxlength: 2000
    }
}, {
    timestamps: true,
    versionKey: false
});

photoCommentSchema.index({ photoId: 1, createdAt: 1 });

export default function getPhotoCommentModel(connection) {
    return connection.models.PhotoComment || connection.model('PhotoComment', photoCommentSchema);
}
