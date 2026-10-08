import mongoose from 'mongoose';

const groupMembershipSchema = new mongoose.Schema({
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Group'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    role: {
        type: String,
        enum: ['member', 'admin'],
        default: 'member'
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'invited', 'rejected'],
        required: true
    },
    joinedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    versionKey: false
});

groupMembershipSchema.index({ groupId: 1, userId: 1 }, { unique: true });
groupMembershipSchema.index({ groupId: 1, status: 1, role: 1 });
groupMembershipSchema.index({ userId: 1, status: 1 });

export default function getGroupMembershipModel(connection) {
    return connection.models.GroupMembership
        || connection.model('GroupMembership', groupMembershipSchema);
}
