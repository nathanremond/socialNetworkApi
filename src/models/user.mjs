import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80
    },
    lastName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 254
    },
    passwordHash: {
        type: String,
        required: true,
        select: false
    }
}, {
    timestamps: true,
    versionKey: false
});

userSchema.index({ email: 1 }, { unique: true });

export default function getUserModel(connection) {
    return connection.models.User || connection.model('User', userSchema);
}
