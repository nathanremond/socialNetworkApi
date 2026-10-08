import mongoose from 'mongoose';

const eventTicketSchema = new mongoose.Schema({
    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Event'
    },
    ticketTypeId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'EventTicketType'
    },
    ticketTypeName: {
        type: String,
        required: true
    },
    priceCents: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        enum: ['EUR'],
        required: true
    },
    buyer: {
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
        fullAddress: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500
        }
    },
    purchasedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    paymentStatus: {
        type: String,
        enum: ['not_integrated'],
        default: 'not_integrated',
        required: true
    }
}, {
    timestamps: true,
    versionKey: false
});

eventTicketSchema.index({ eventId: 1, 'buyer.email': 1 }, { unique: true });
eventTicketSchema.index({ eventId: 1, purchasedAt: -1 });

export default function getEventTicketModel(connection) {
    return connection.models.EventTicket || connection.model('EventTicket', eventTicketSchema);
}
