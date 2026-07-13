// server.js
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = 3000;

// 中间件
app.use(cors()); // 允许前端跨域访问
app.use(bodyParser.json());

// 初始化 SQLite 数据库
const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) {
    console.error("数据库连接失败:", err.message);
  } else {
    console.log("已连接到 SQLite 数据库");
    initDb();
  }
});

// 初始化表结构和测试数据
function initDb() {
  db.serialize(() => {
    // 创建工单表
    db.run(`CREATE TABLE IF NOT EXISTS production_orders (
            id TEXT PRIMARY KEY,
            productModel TEXT,
            orderType TEXT,
            quantity INTEGER,
            completed INTEGER DEFAULT 0,
            completion INTEGER DEFAULT 0,
            status_code TEXT,
            status_text TEXT,
            priority TEXT,
            startTime TEXT,
            endTime TEXT,
            createTime TEXT,
            bomList TEXT,
            processRoute TEXT,
            remarks TEXT
        )`);

    // 检查是否为空，如果为空插入一条测试数据
    db.get("SELECT count(*) as count FROM production_orders", (err, row) => {
      if (row.count === 0) {
        const stmt = db.prepare(
          `INSERT INTO production_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        stmt.run(
          "WO20250805001",
          "AX-100",
          "normal",
          100,
          75,
          75,
          "in_progress",
          "生产中",
          "normal",
          "2025-08-05T10:00",
          "2025-08-07T18:00",
          "2025-08-05 09:30",
          "bom-001",
          "route-001",
          "初始化测试数据",
        );
        stmt.finalize();
        console.log("已插入初始化测试数据");
      }
    });
  });
}

// --- API 接口 ---

// 1. 获取所有工单
app.get("/api/orders", (req, res) => {
  db.all(
    "SELECT * FROM production_orders ORDER BY createTime DESC",
    [],
    (err, rows) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      // 处理数据格式以匹配前端（重组 status 对象）
      const formattedRows = rows.map((row) => ({
        ...row,
        status: {
          code: row.status_code,
          text: row.status_text,
          class: getStatusClass(row.status_code),
        },
      }));
      res.json({ message: "success", data: formattedRows });
    },
  );
});

// 2. 创建新工单
app.post("/api/orders", (req, res) => {
  const data = req.body;
  // 生成 ID (简单模拟)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomNum = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  const newId = `WO${dateStr}${randomNum}`;

  const now = new Date();
  const createTime =
    now.toISOString().slice(0, 10) + " " + now.toTimeString().slice(0, 5);

  const sql = `INSERT INTO production_orders (
        id, productModel, orderType, quantity, completed, completion,
        status_code, status_text, priority, startTime, endTime,
        createTime, bomList, processRoute, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const params = [
    newId,
    data.productModel,
    data.orderType,
    data.quantity,
    0,
    0,
    "pending",
    "待派工",
    data.priority,
    data.startTime,
    data.endTime,
    createTime,
    data.bomList,
    data.processRoute,
    data.remarks,
  ];

  db.run(sql, params, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", id: newId });
  });
});

// 3. 更新工单
app.put("/api/orders/:id", (req, res) => {
  const data = req.body;
  const sql = `UPDATE production_orders SET
    productModel = ?, orderType = ?, quantity = ?, priority = ?,
    startTime = ?, endTime = ?, bomList = ?, processRoute = ?, remarks = ?
    WHERE id = ?`;

  const params = [
    data.productModel,
    data.orderType,
    data.quantity,
    data.priority,
    data.startTime,
    data.endTime,
    data.bomList,
    data.processRoute,
    data.remarks,
    req.params.id,
  ];

  db.run(sql, params, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success" });
  });
});

// 4. 删除工单
app.delete("/api/orders/:id", (req, res) => {
  db.run(
    "DELETE FROM production_orders WHERE id = ?",
    req.params.id,
    function (err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ message: "deleted", changes: this.changes });
    },
  );
});

// 辅助函数：根据状态码获取样式
function getStatusClass(code) {
  const map = {
    in_progress: "bg-info/10 text-info",
    completed: "bg-success/10 text-success",
    pending: "bg-warning/10 text-warning",
    cancelled: "bg-danger/10 text-danger",
  };
  return map[code] || "bg-gray-100 text-gray-500";
}
// 6. 获取单个工单的追溯信息
app.get("/api/orders/:id/tracking", (req, res) => {
  const orderId = req.params.id;

  db.get(
    "SELECT * FROM production_orders WHERE id = ?",
    [orderId],
    (err, row) => {
      if (err) {
        return res.status(400).json({ message: "error", error: err.message });
      }
      if (!row) {
        return res
          .status(404)
          .json({ message: "error", error: "未找到该工单" });
      }

      // 组装 status 对象
      const status = {
        code: row.status_code,
        text: row.status_text,
        class: getStatusClass(row.status_code),
      };

      // 这里简单认为 completed 都是合格品，未专门区分不合格
      const qualified = row.completed || 0;
      const unqualified = 0;

      // 组装一个追溯详情对象，字段名和前端 renderTrackingResult 对应
      const detail = {
        id: row.id,
        productModel: row.productModel,
        quantity: row.quantity,
        completed: row.completed,
        qualified,
        unqualified,
        status,
        createTime: row.createTime,
        creator: "系统", // 目前没有创建人字段，先写死，后续你可以加列
        startTime: row.startTime,
        endTime: row.endTime,

        // 简单生成一条时间线数据（你后面可以扩展成多条、接真实日志表）
        timeline: [
          {
            time: row.createTime,
            title: "工单创建",
            desc: `创建工单 ${row.id}，产品型号 ${row.productModel}`,
            done: true,
          },
          row.startTime && {
            time: row.startTime.replace("T", " "),
            title: "开始生产",
            desc: "工单开始生产",
            done: true,
          },
          row.endTime && {
            time: row.endTime.replace("T", " "),
            title: "计划完成",
            desc: "计划完成时间",
            planned: true,
            done: false,
          },
        ].filter(Boolean),

        // 目前数据库没有生产记录、物料记录表，先返回空数组
        productionRecords: [],
        materials: [],
      };

      res.json({ message: "success", data: detail });
    },
  );
});
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

// ... 之前的代码 ...

// 5. [新增] 获取每日生产统计数据（用于图表）
app.get("/api/stats/daily", (req, res) => {
  // SQL 逻辑：
  // 1. substr(startTime, 1, 10) 截取日期部分 (例如 2025-08-05)
  // 2. SUM(quantity) 统计当天的总计划产量
  // 3. SUM(completed) 统计当天的总实际完成量
  // 4. GROUP BY 按日期分组
  // 5. ORDER BY 按日期排序，取最近 7 天
  const sql = `
    SELECT
    substr(startTime, 1, 10) as date,
        SUM(quantity) as total_plan,
        SUM(completed) as total_actual
        FROM production_orders
        WHERE startTime IS NOT NULL AND startTime != ''
        GROUP BY substr(startTime, 1, 10)
        ORDER BY date ASC
        LIMIT 14
        `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", data: rows });
  });
});

// ... app.listen ...
