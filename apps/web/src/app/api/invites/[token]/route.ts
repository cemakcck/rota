import { route } from "@/server/http";
import { acceptLink } from "@/server/trips/invites";

export const POST = route(async ({ user, params }) => acceptLink(params.token, user.id));
