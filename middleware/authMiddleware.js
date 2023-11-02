const asyncHandler = require("express-async-handler")
const User = require("../models/userModel")
const jwt = require("jsonwebtoken")

const protect = asyncHandler(async (req, res, next) => {
    try {
        const token = req.cookies.token
        if (!token) {
            res.status(401)
            throw new Error("Not authorized, please login")
        }

        // Verify Token
        const Verified = jwt.verify(token, process.env.JWT_SECRET)
        // Get user id from token
        const user = await User.findById(Verified.id).select("-password")

        if (!user) {
            res.status(401)
            throw new Error("User not found")
        }

        if (user.role === "suspended") {
            res.status(400)
            throw new Error("User Suspended, please contact support")
        }

        req.user = user
        next()

    } catch (error) {
        res.status(401)
        throw new Error("Not authorized, please login")

    }
})

const adminOnly = asyncHandler(async (req, res, next) => {
    if (req.user && req.user.role === "admin") {
        next()
    } else {
        res.status(401)
        throw new Error("Not authorized as admin")

    }
})

const authorOnly = asyncHandler(async (req, res, next) => {
    if (req.user && req.user.role === "author" || req.user.role === "admin") {
        next()
    } else {
        res.status(401)
        throw new Error("Not authorized as author")

    }
})

const verifiedOnly = asyncHandler(async (req, res, next) => {
    if (req.user && req.user.isVerified) {
        next()
    } else {
        res.status(401)
        throw new Error("Not authorized as admin")

    }
})

module.exports = {
    protect,
    adminOnly,
    authorOnly,
    verifiedOnly,
}