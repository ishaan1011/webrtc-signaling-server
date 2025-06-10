// webrtc-signaling-server/models/Workspace.js
import mongoose from 'mongoose';

const WorkspaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  createdBy: { type: String, required: true }, // userId or userName
  createdAt: { type: Date, default: Date.now },
  // You can add “members: [String]” or “permissions” later if needed
});

export default mongoose.model('Workspace', WorkspaceSchema);