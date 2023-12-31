const asyncHandler = require("express-async-handler")
const User = require("../models/userModel")
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken")
const { generateToken, hashToken } = require("../utils");
var parser = require("ua-parser-js");
const sendEmail = require("../utils/sendEmail");
const Token = require("../models/tokenModel");
const crypto = require("crypto");
const Cryptr = require('cryptr');
const { OAuth2Client } = require("google-auth-library")


const cryptr = new Cryptr(process.env.CRYPTR_KEY);
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const registerUser = asyncHandler(async (req, res) => {
    const { name, email, password } = req.body

    //Validation
    if (!name || !email || !password) {
        res.status(400)
        throw new Error("Please fill in all the required fields")
    }

    if (password.length < 6) {
        res.status(400)
        throw new Error("Password must be up to 6 characters.")
    }

    // Check if user exists 
    const userExist = await User.findOne({ email })

    if (userExist) {
        res.status(400)
        throw new Error("Email already in use.")
    }

    // Get UserAgent
    const ua = parser(req.headers["user-agent"])
    const userAgent = [ua.ua]

    // Create new user
    const user = await User.create({
        name,
        email,
        password,
        userAgent,
    })

    // Generate Token
    const token = generateToken(user._id)

    // Send HTTP-only cookie
    res.cookie("token", token, {
        path: "/",
        httpOnly: true,
        expires: new Date(Date.now() + 1000 * 86400), //1 day
        sameSite: "none",
        secure: true,
    })

    if (user) {
        const { _id, name, email, phone, bio, photo, role, isVerified } = user

        res.status(201).json({
            _id, name, email, phone, bio, photo, role, isVerified, token
        })
    } else {
        res.status(400)
        throw new Error("Invalid user data")
    }
});

// Login User
const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body

    // Validate Request
    if (!email || !password) {
        res.status(404)
        throw new Error("Please add email and password")
    }

    // Check if user exists in DB
    const user = await User.findOne({ email })

    if (!user) {
        res.status(404)
        throw new Error("User not found please sign up")
    }

    // User exists, check if password is correct
    const passwordIsCorrect = await bcrypt.compare(password, user.password)

    if (!passwordIsCorrect) {
        res.status(400)
        throw new Error("Invalid email or password")
    }

    // Trigger 2FA for unknown UserAgent
    const ua = parser(req.headers["user-agent"])
    const thisuserAgent = ua.ua

    console.log(thisuserAgent);

    const allowedAgent = user.userAgent.includes(thisuserAgent)

    if (!allowedAgent) {
        // Generate 6 digits code
        const loginCode = Math.floor(100000 + Math.random() * 900000)
        console.log(loginCode);

        // Encrypt login code before saving to DB
        const encryptedLoginCode = cryptr.encrypt(loginCode.toString())

        // Delete Token if it exist in the database
        let userToken = await Token.findOne({ userId: user._id })

        if (userToken) {
            await userToken.deleteOne()
        }


        // Save Token to DB
        await new Token({
            userId: user._id,
            loginToken: encryptedLoginCode,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60 * (60 * 1000), //60mins
        }).save()

        res.status(400)
        throw new Error("New Device dectected")
    }


    // Generate Token
    const token = generateToken(user._id)

    if (user && passwordIsCorrect) {
        // Send HTTP-only cookie
        res.cookie("token", token, {
            path: "/",
            httpOnly: true,
            expires: new Date(Date.now() + 1000 * 86400), // one day
            sameSite: "none",
            secure: true,
        });
    }

    if (user && passwordIsCorrect) {
        const { _id, name, email, phone, bio, photo, role, isVerified } = user

        res.status(200).json({
            _id,
            name,
            email,
            phone,
            bio,
            photo,
            role,
            isVerified,
            // token
        })
    } else {
        res.status(500)
        throw new Error("Something went wrong try again")
    }
})

// Send Login code via email
const sendLoginCode = asyncHandler(async (req, res) => {
    const { email } = req.params
    const user = await User.findOne({ email })

    if (!user) {
        res.status(404)
        throw new Error("User not found")
    }

    // Find Login code in DB
    let userToken = await Token.findOne({ userId: user._id, expiresAt: { $gt: Date.now() } })

    if (!userToken) {
        res.status(404)
        throw new Error("Invalid or Expired token, please login again")
    }

    const loginCode = userToken.loginToken
    const decryptedLoginCode = cryptr.decrypt(loginCode)

    // Send Login Code
    const subject = "Login Access Code - AUTH:APP"
    const send_to = email
    const sent_from = process.env.EMAIL_USER
    const reply_to = "noreplay@example.com"
    const template = "loginCode"
    const name = user.name
    const link = decryptedLoginCode

    try {
        await sendEmail(
            subject,
            send_to,
            sent_from,
            reply_to,
            template,
            name,
            link
        )
        res.status(200).json({ message: `Access Code sent to ${email}.` })
    } catch (error) {
        res.status(500)
        throw new Error("Email not sent, please try again")
    }
})

// Login with Code
const loginWithCode = asyncHandler(async (req, res) => {
    const { email } = req.params
    const { loginCode } = req.body

    const user = await User.findOne({ email })

    if (!user) {
        res.status(404)
        throw new Error("User not found")
    }

    // Find Login code in DB
    let userToken = await Token.findOne({ userId: user._id, expiresAt: { $gt: Date.now() } })

    if (!userToken) {
        res.status(404)
        throw new Error("Invalid or Expired Token please login again")
    }


    const decryptedLoginCode = cryptr.decrypt(userToken.loginToken)

    if (loginCode !== decryptedLoginCode) {
        res.status(400)
        throw new Error("Incorrect login code, please try again")
    } else {
        // Register User Agent
        const ua = parser(req.headers["user-agent"])
        const thisuserAgent = ua.ua

        user.userAgent.push(thisuserAgent)

        // Save user
        await user.save()

        // Generate Token
        const token = generateToken(user._id)

        // Send HTTP-only cookie
        res.cookie("token", token, {
            path: "/",
            httpOnly: true,
            expires: new Date(Date.now() + 1000 * 86400), //1 day
            sameSite: "none",
            secure: true,
        })

        const { _id, name, email, phone, bio, photo, role, isVerified } = user

        res.status(200).json({
            _id, name, email, phone, bio, photo, role, isVerified, token
        })
    }
})

const verificationEmail = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    if (!user) {
        res.status(404)
        throw new Error("User not found")
    }

    if (user.isVerified) {
        res.status(400)
        throw new Error("User already verified")
    }

    // Delete Token if it exist in the database
    let token = await Token.findOne({ userId: user._id })

    if (token) {
        await token.deleteOne()
    }

    // Create Verification token and save in DB
    const verificationToken = crypto.randomBytes(32).toString("hex") + user._id
    // console.log(verificationToken);

    // Hash token and save
    const hashedToken = hashToken(verificationToken)
    await new Token({
        userId: user._id,
        verificationToken: hashedToken,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * (60 * 1000), //60mins
    }).save()

    // Construct Verification URL
    const verificationUrl = `${process.env.FRONTEND_URL}/verify/${verificationToken}`

    // Send verification email
    const subject = "Verify Your Account - AUTH:APP"
    const send_to = user.email
    const sent_from = process.env.EMAIL_USER
    const reply_to = "noreplay@example.com"
    const template = "verifyEmail"
    const name = user.name
    const link = verificationUrl

    try {
        await sendEmail(
            subject,
            send_to,
            sent_from,
            reply_to,
            template,
            name,
            link
        )
        res.status(200).json({ message: "Verification Email Sent" })
    } catch (error) {
        res.status(500)
        throw new Error("Email not sent, please try again")
    }
})

// Verify User
const verifyUser = asyncHandler(async (req, res) => {
    const { verificationToken } = req.params

    const hashedToken = hashToken(verificationToken)

    const userToken = await Token.findOne({
        verificationToken: hashedToken,
        expiresAt: { $gt: Date.now() }
    })

    if (!userToken) {
        res.status(404)
        throw new Error("Invalid or Expired Token")
    }

    // Find User
    const user = await User.findOne({ _id: userToken.userId })

    if (user.isVerified) {
        res.status(400)
        throw new Error("User is already verified")
    }

    // Now Verify User
    user.isVerified = true
    await user.save()

    res.status(200).json({ message: "Account Verification Successful" })
})


// Logout User
const logoutUser = asyncHandler(async (req, res) => {
    res.cookie("token", "", {
        path: "/",
        httpOnly: true,
        expires: new Date(0),
        sameSite: "none",
        secure: true,
    });

    return res.status(200).json({ message: "Successfully Logged Out" })
})

// Get User Data
const getUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    if (user) {
        const { _id, name, email, phone, bio, photo, role, isVerified } = user

        res.status(200).json({
            _id,
            name,
            email,
            phone,
            bio,
            photo,
            role,
            isVerified,
        })
    } else {
        res.status(404)
        throw new Error("User not found")
    }
})

// Update User
const updateUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    if (user) {
        const { name, email, phone, bio, photo, role, isVerified } = user
        user.email = email
        user.name = req.body.name || name
        user.phone = req.body.phone || phone
        user.bio = req.body.bio || bio
        user.photo = req.body.photo || photo

        const updatedUser = await user.save()
        res.status(200).json({
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            phone: updatedUser.phone,
            bio: updatedUser.bio,
            photo: updatedUser.photo,
            role: updatedUser.role,
            isVerified: updatedUser.isVerified,
        })
    } else {
        res.status(404)
        throw new Error("User not found")
    }
})

// Delete User
const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
        res.status(404)
        throw new Error("User not found please sign up")
    }

    res.status(200).json({
        message: "User deleted succssfully"
    })
})

// Get Users
const getUsers = asyncHandler(async (req, res) => {
    const users = await User.find().sort("-createdAt").select("-password")

    if (!users) {
        res.status(500)
        throw new Error("Something went wrong")
    }
    res.status(200).json(users)
})

// Get login status
const loginStatus = asyncHandler(async (req, res) => {
    const token = req.cookies.token
    if (!token) {
        return res.json(false)
    }
    // Verify Token
    const Verified = jwt.verify(token, process.env.JWT_SECRET)
    if (Verified) {
        return res.json(true)
    }
    return res.json(false)
})

// Upgrade User
const upgradeUser = asyncHandler(async (req, res) => {
    const { role, id } = req.body

    const user = await User.findById(id)

    if (!user) {
        res.status(500)
        throw new Error("User not found")
    }

    user.role = role
    await user.save()

    res.status(200).json({
        message: `User role updated to ${role}`
    })
})


// Send Automated Email
const sendAutomatedEmail = asyncHandler(async (req, res) => {
    const { subject, send_to, reply_to, template, url } = req.body

    if (!subject || !send_to || !reply_to || !template) {
        res.status(500)
        throw new Error("Missing email parameters")
    }

    // Get User
    const user = await User.findOne({ email: send_to })

    if (!user) {
        res.status(404)
        throw new Error("User not found")
    }

    const sent_from = process.env.EMAIL_USER
    const name = user.name
    const link = `${process.env.FRONTEND_URL}${url}`

    try {
        await sendEmail(
            subject,
            send_to,
            sent_from,
            reply_to,
            template,
            name,
            link
        )
        res.status(200).json({ message: "Email Sent" })
    } catch (error) {
        res.status(500)
        throw new Error("Email not sent, please try again")
    }
})

// Forgot password
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body
    const user = await User.findOne({ email })

    if (!user) {
        res.status(404)
        throw new Error("No user with this email")
    }

    // Delete Token if it exist in the database
    let token = await Token.findOne({ userId: user._id })

    if (token) {
        await token.deleteOne()
    }

    // Create reset token and save in DB
    const resetToken = crypto.randomBytes(32).toString("hex") + user._id
    console.log(resetToken);


    // Hash token and save
    const hashedToken = hashToken(resetToken)
    await new Token({
        userId: user._id,
        resetToken: hashedToken,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * (60 * 1000), //60mins
    }).save()

    // Construct Reset URL
    const resetUrl = `${process.env.FRONTEND_URL}/resetPassword/${resetToken}`

    // Send Reset email
    const subject = "Password Reset Request - AUTH:APP"
    const send_to = user.email
    const sent_from = process.env.EMAIL_USER
    const reply_to = "noreplay@example.com"
    const template = "forgotPassword"
    const name = user.name
    const link = resetUrl

    try {
        await sendEmail(
            subject,
            send_to,
            sent_from,
            reply_to,
            template,
            name,
            link
        )
        res.status(200).json({ message: "Password Reset Email Sent" })
    } catch (error) {
        res.status(500)
        throw new Error("Email not sent, please try again")
    }

})

// Reset Password
const resetPassword = asyncHandler(async (req, res) => {
    const { resetToken } = req.params
    const { password } = req.body

    const hashedToken = hashToken(resetToken)

    const userToken = await Token.findOne({
        resetToken: hashedToken,
        expiresAt: { $gt: Date.now() }
    })

    if (!userToken) {
        res.status(404)
        throw new Error("Invalid or Expired Token")
    }

    // Find User
    const user = await User.findOne({ _id: userToken.userId })

    // Now Reset User
    user.password = password
    await user.save()

    res.status(200).json({ message: "Password Reset Successfull Please login" })
})

// Change Password
const changePassword = asyncHandler(async (req, res) => {
    const { oldPassword, password } = req.body
    const user = await User.findById(req.user._id)

    if (!user) {
        res.status(404)
        throw new Error("User not found")
    }

    if (!oldPassword || !password) {
        res.status(404)
        throw new Error("Please enter old and new password")
    }

    // Check if old password is correct
    const passwordIsCorrect = await bcrypt.compare(oldPassword, user.password)

    // Save new password
    if (user && passwordIsCorrect) {
        user.password = password
        await user.save()

        res.status(200).json({ message: "Password changed successfully, please login" })
    } else {
        res.status(404)
        throw new Error("Old password is incorrect")
    }
})

// Login with google
const loginWithGoogle = asyncHandler(async (req, res) => {
    const { userToken } = req.body

    const ticket = await client.verifyIdToken({
        idToken: userToken,
        audience: process.env.GOOGLE_CLIENT_ID,
    })

    const payload = ticket.getPayload()
    const { name, email, picture, sub } = payload
    const password = Date.now() + sub



    // Check if user exist
    const user = await User.findOne({ email })

    // Get UserAgent
    const ua = parser(req.headers["user-agent"])
    const userAgent = [ua.ua]

    if (!user) {


        // Create new user
        const newUser = await User.create({
            name,
            email,
            password,
            photo: picture,
            isVerified: true,
            userAgent,
        })

        if (newUser) {
            // Generate Token
            const token = generateToken(newUser._id)

            // Send HTTP-only cookie
            res.cookie("token", token, {
                path: "/",
                httpOnly: true,
                expires: new Date(Date.now() + 1000 * 86400), //1 day
                sameSite: "none",
                secure: true,
            })

            const { _id, name, email, phone, bio, photo, role, isVerified } = newUser

            res.status(201).json({
                _id, name, email, phone, bio, photo, role, isVerified, token
            })
        }

    }

    // If User Exist Login
    if (user) {
        // Generate Token
        const token = generateToken(user._id)

        // Send HTTP-only cookie
        res.cookie("token", token, {
            path: "/",
            httpOnly: true,
            expires: new Date(Date.now() + 1000 * 86400), //1 day
            sameSite: "none",
            secure: true,
        })

        const { _id, name, email, phone, bio, photo, role, isVerified } = user

        res.status(201).json({
            _id, name, email, phone, bio, photo, role, isVerified, token
        })
    }
})



module.exports = {
    registerUser,
    loginUser,
    logoutUser,
    getUser,
    updateUser,
    deleteUser,
    getUsers,
    loginStatus,
    upgradeUser,
    sendAutomatedEmail,
    verificationEmail,
    verifyUser,
    forgotPassword,
    resetPassword,
    changePassword,
    sendLoginCode,
    loginWithCode,
    loginWithGoogle,
}