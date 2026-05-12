require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// ========== CONFIGURATION ==========
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;

// Products bin (expects { products: [...] })
const PRODUCTS_BIN_ID = process.env.JSONBIN_BIN_ID;
const PRODUCTS_URL = `https://api.jsonbin.io/v3/b/${PRODUCTS_BIN_ID}`;

// Orders bin (expects { orders: [...] })
const ORDERS_BIN_ID = process.env.ORDER_JSONBIN_BIN_ID;
const ORDERS_URL = `https://api.jsonbin.io/v3/b/${ORDERS_BIN_ID}`;

// Helper: generic read from a bin that contains a top-level property
const readFromBin = async (url, key) => {
  const res = await fetch(url, {
    headers: { 'X-Master-Key': JSONBIN_API_KEY }
  });
  if (!res.ok) throw new Error(`JSONBin read failed: ${res.status}`);
  const data = await res.json();
  return data.record?.[key] || [];
};

// Helper: generic write to a bin, storing object with top-level property
const writeToBin = async (url, key, data) => {
  const payload = { [key]: data };
  const res = await fetch(url, {
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

// ========== PRODUCTS ==========
const readProducts = () => readFromBin(PRODUCTS_URL, 'products');
const writeProducts = (products) => writeToBin(PRODUCTS_URL, 'products', products);

const getNextDressCode = async () => {
  const products = await readProducts();
  let max = 1001000;
  for (const p of products) {
    const num = parseInt(p.dressCode, 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return (max + 1).toString();
};

app.get('/api/products', async (req, res) => {
  try {
    const products = await readProducts();
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

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

app.post('/api/products', upload.array('images', 8), async (req, res) => {
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

app.put('/api/products/:id', upload.array('images', 8), async (req, res) => {
  try {
    let products = await readProducts();
    const index = products.findIndex(p => p.id == req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });

    let keptImageUrls = [];
    if (req.body.existingImages) {
      try {
        keptImageUrls = JSON.parse(req.body.existingImages);
      } catch (e) {
        keptImageUrls = [];
      }
    }
    if (!Array.isArray(keptImageUrls)) keptImageUrls = [];

    let newImageUrls = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path);
        newImageUrls.push(result.secure_url);
        fs.unlinkSync(file.path);
      }
    }

    let finalImageUrls = [...keptImageUrls, ...newImageUrls];
    if (finalImageUrls.length > 8) {
      return res.status(400).json({ error: 'Maximum 8 images allowed per product' });
    }

    const updated = {
      ...products[index],
      ...req.body,
      imageUrls: finalImageUrls,
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

// ========== ORDERS ==========
const readOrders = () => readFromBin(ORDERS_URL, 'orders');
const writeOrders = (orders) => writeToBin(ORDERS_URL, 'orders', orders);

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await readOrders();
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const orders = await readOrders();
    const newOrder = {
      id: Date.now(),
      orderCode: `ORD-${Date.now()}`,
      customer: req.body.customer,
      items: req.body.items,
      total: req.body.total,
      paymentPreference: req.body.paymentPreference,
      status: req.body.status || 'pending',
      createdAt: new Date().toISOString(),
    };
    orders.push(newOrder);
    await writeOrders(orders);
    res.status(201).json(newOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    let orders = await readOrders();
    const id = parseInt(req.params.id);
    const index = orders.findIndex(o => o.id === id);
    if (index === -1) return res.status(404).json({ error: 'Order not found' });
    orders[index] = { ...orders[index], ...req.body };
    await writeOrders(orders);
    res.json(orders[index]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// ========== NEW: DELETE ORDER ==========
app.delete('/api/orders/:id', async (req, res) => {
  try {
    let orders = await readOrders();
    const id = parseInt(req.params.id);
    const newOrders = orders.filter(o => o.id !== id);
    if (newOrders.length === orders.length) {
      return res.status(404).json({ error: 'Order not found' });
    }
    await writeOrders(newOrders);
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// ========== ROOT ==========
app.get('/', (req, res) => {
  res.send('Geftshop API is running. Visit /api/products or /api/orders');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));