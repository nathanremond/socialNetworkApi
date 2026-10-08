import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        required: true,
        trim: true,
        maxlength: 5000
    },
    iconUrl: {
        type: String,
        default: null
    },
    coverUrl: {
        type: String,
        default: null
    },
    visibility: {
        type: String,
        enum: ['public', 'private', 'secret'],
        required: true
    },
    memberCanPost: {
        type: Boolean,
        default: false
    },
    memberCanCreateEvents: {
        type: Boolean,
        default: false
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

groupSchema.index({ visibility: 1, name: 1 });

export default function getGroupModel(connection) {
    return connection.models.Group || connection.model('Group', groupSchema);
}
