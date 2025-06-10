// webrtc-signaling-server/models/Message.js
import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  workspaceId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  threadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Thread',    required: true },
  sender:       { type: String, required: true },             // userName or userId
  content:      { type: String, required: true },
  contentType:  { type: String, enum: ['text', 'file', 'clip'], default: 'text' },
  mediaUrl:     { type: String, default: '' },                // if it’s a file/clip
  createdAt:    { type: Date, default: Date.now },
});

export default mongoose.model('Message', MessageSchema);