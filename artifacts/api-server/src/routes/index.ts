import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import flightsRouter from "./flights";
import queueRouter from "./queue";
import tripsRouter from "./trips";
import passengersRouter from "./passengers";
import membershipRouter from "./membership";
import referralRouter from "./referral";
import notificationsRouter from "./notifications";
import conciergeRouter from "./concierge";
import devRouter from "./dev";
import networkingRouter from "./networking";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(devRouter);
router.use("/auth", authRouter);
router.use("/flights", flightsRouter);
router.use("/queue", queueRouter);
router.use("/trips", tripsRouter);
router.use("/passengers", passengersRouter);
router.use("/membership", membershipRouter);
router.use("/referral", referralRouter);
router.use("/notifications", notificationsRouter);
router.use("/concierge", conciergeRouter);
router.use("/networking", networkingRouter);
router.use(storageRouter);

export default router;
