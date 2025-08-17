const express = require("express");
const router = express.Router();
const ImageKit = require("imagekit");

console.log("Public Key:", process.env.IMAGEKIT_PUBLIC_KEY);
console.log("Private Key:", process.env.IMAGEKIT_PRIVATE_KEY);
console.log("Endpoint:", process.env.IMAGEKIT_URL_ENDPOINT);

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY, // Set these in your .env file!
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT, // e.g. https://ik.imagekit.io/yourid/
});

router.get("/auth", (req, res) => {
  const authParams = imagekit.getAuthenticationParameters();
  res.json(authParams);
});

module.exports = router;
