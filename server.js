require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fetch = require('node-fetch');
const fs = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// JSONBin config
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// Read products – handles {"products": [...]} structure
const readProducts = async () => {
  const res = await fetch(JSONBIN_URL, {
    headers: { 'X-Master-Key': JSONBIN_API_KEY }
  });
  if (!res.ok) throw new Error(`JSONBin read failed: ${res.status}`);
  const data = await res.json();
  return data.record?.products || [];
};

// Write products – preserves {"products": [...]}
const writeProducts = async (products) => {
  const payload = { products };
  const res = await fetch(JSONBIN_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': JSONBIN_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`JSONBin write failed: ${res.status} ${errorText}`);
  }
  return res.json();
};

// Helper to generate next dress code (1001001, 1001002, ...)
const getNextDressCode = async () => {
  const products = await readProducts();
  let max = 1001000;
  for (const p of products) {
    const num = parseInt(p.dressCode, 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return (max + 1).toString();
};

// GET all products
app.get('/api/products', async (req, res) => {
  try {
    const products = await readProducts();
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const products = await readProducts();
    const product = products.find(p => p.id == req.params.id);
    product ? res.json(product) : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST new product (multiple images)
app.post('/api/products', upload.array('images', 10), async (req, res) => {
  try {
    let imageUrls = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path);
        imageUrls.push(result.secure_url);
        fs.unlinkSync(file.path);
      }
    }

    const products = await readProducts();
    const nextDressCode = await getNextDressCode();

    const newProduct = {
      id: Date.now(),
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      color: req.body.color,
      size: req.body.size,
      stock: parseInt(req.body.stock) || 0,
      dressCode: nextDressCode,
      productWeight: parseFloat(req.body.productWeight) || 0,
      shippingFee: parseFloat(req.body.shippingFee) || 0,
      weightKg: parseFloat(req.body.weightKg) || 0,
      bust: parseFloat(req.body.bust) || 0,
      length: parseFloat(req.body.length) || 0,
      waist: parseFloat(req.body.waist) || 0,
      asianSize: req.body.asianSize || '',
      imageUrls: imageUrls,
    };

    products.push(newProduct);
    await writeProducts(products);
    res.status(201).json(newProduct);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// PUT update product (multiple images – replace old ones)
app.put('/api/products/:id', upload.array('images', 10), async (req, res) => {
  try {
    let products = await readProducts();
    const index = products.findIndex(p => p.id == req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });

    let imageUrls = products[index].imageUrls || [];
    if (req.files && req.files.length) {
      // Replace old images with new ones
      imageUrls = [];
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path);
        imageUrls.push(result.secure_url);
        fs.unlinkSync(file.path);
      }
    }

    const updated = {
      ...products[index],
      ...req.body,
      imageUrls: imageUrls,
      price: parseFloat(req.body.price) || products[index].price,
      stock: parseInt(req.body.stock) !== undefined ? parseInt(req.body.stock) : products[index].stock,
    };
    products[index] = updated;
    await writeProducts(products);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

// DELETE product
app.delete('/api/products/:id', async (req, res) => {
  try {
    let products = await readProducts();
    const newProducts = products.filter(p => p.id != req.params.id);
    if (newProducts.length === products.length) return res.status(404).json({ error: 'Not found' });
    await writeProducts(newProducts);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));