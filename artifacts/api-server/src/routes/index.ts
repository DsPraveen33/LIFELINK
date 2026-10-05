import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import lifelinkRouter from "./lifelink";
import simulationRouter from "./simulation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(lifelinkRouter);
router.use(simulationRouter);

export default router;
