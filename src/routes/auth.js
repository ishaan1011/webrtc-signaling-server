import { Router } from 'express'
import User from '../models/user.js'
import { signToken, verifyToken } from '../utils/jwt.js'

const router = Router()

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, name, email, password } = req.body
  try {
    // check if user exists
    let user = await User.findOne({ email })
    if (user) return res.status(400).json({ message: 'Email already in use' })

    user = new User({ username, name, email, password })
    await user.save()

    const token = signToken({ userId: user._id })
    res.json({ token })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  try {
    const user = await User.findOne({ email })
    if (!user) return res.status(400).json({ message: 'Invalid credentials' })

    const isMatch = await user.comparePassword(password)
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' })

    const token = signToken({ userId: user._id })
    res.json({ token })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ message: 'No token provided' })

  const token = authHeader.split(' ')[1]
  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.userId).select('-password')
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json(user)
  } catch (err) {
    console.error(err)
    res.status(401).json({ message: 'Invalid token' })
  }
})

export default router