// webrtc-signaling-server/models/Thread.js
import mongoose from 'mongoose';

const ThreadSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true },            // e.g. “#general”, “#engineering”
  isLocked: { type: Boolean, default: false },        // optional “lock” behavior
  createdBy: { type: String, required: true },        // userName or userId
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Thread', ThreadSchema);