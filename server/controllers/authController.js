const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' })
}

async function register(req, res) {
  try {
    const { name, email, password } = req.body
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are all required' })
    }
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await User.create({ name, email, password: hashedPassword })
    res.status(201).json({
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email, preferences: user.preferences },
    })
  } catch (err) {
    res.status(500).json({ message: 'Registration failed', error: err.message })
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body
    const user = await User.findOne({ email })
    if (!user) return res.status(401).json({ message: 'Invalid email or password' })
    const passwordMatches = await bcrypt.compare(password, user.password)
    if (!passwordMatches) return res.status(401).json({ message: 'Invalid email or password' })
    res.json({
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email, preferences: user.preferences },
    })
  } catch (err) {
    res.status(500).json({ message: 'Login failed', error: err.message })
  }
}

/**
 * GET /api/auth/me
 * Returns the logged-in user's profile + preferences, for restoring
 * state after a page refresh (token persists in localStorage, but
 * React state doesn't -- this is what re-hydrates it).
 */
async function getMe(req, res) {
  try {
    const user = await User.findById(req.userId).select('-password')
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ user: { id: user._id, name: user.name, email: user.email, preferences: user.preferences } })
  } catch (err) {
    res.status(500).json({ message: 'Could not fetch profile', error: err.message })
  }
}

module.exports = { register, login, getMe }
