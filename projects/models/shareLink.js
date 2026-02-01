const mongoose = require("mongoose");

const shareLinkSchema = new mongoose.Schema(
    {
        token: { type: String, required: true, unique: true },
        projectId: { type: mongoose.Schema.Types.ObjectId, required: true },
        permission: {
            type: String,
            required: true,
            enum: ["VIEW", "EDIT"]
        },
        createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
        revoked: { type: Boolean, default: false },
        expiresAt: { type: Date, default: null },
    },
    {
        timestamps: true,
    }
);

shareLinkSchema.index({ token: 1 });
shareLinkSchema.index({ projectId: 1 });

module.exports = mongoose.model("shareLink", shareLinkSchema);