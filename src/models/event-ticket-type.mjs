import mongoose from 'mongoose';

const eventTicketTypeSchema = new mongoose.Schema({
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
    priceCents: {
        type: Number,
        required: true,
        min: 0,
        validate: Number.isSafeInteger
    },
    currency: {
        type: String,
        enum: ['EUR'],
        default: 'EUR',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isSafeInteger
    },
    sold: {
        type: Number,
        default: 0,
        min: 0,
        validate: Number.isSafeInteger
    }
}, {
    timestamps: true,
    versionKey: false
});

eventTicketTypeSchema.index({ eventId: 1, createdAt: 1 });

export default function getEventTicketTypeModel(connection) {
    return connection.models.EventTicketType
        || connection.model('EventTicketType', eventTicketTypeSchema);
}
