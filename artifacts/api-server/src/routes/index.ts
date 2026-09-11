import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import streamRouter from "./stream";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/stream", streamRouter);

export default router;
