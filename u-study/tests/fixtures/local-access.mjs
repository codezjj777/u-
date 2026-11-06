import {authorization,createAccessToken,dashboardURL} from '../../local-access.mjs';

export const accessToken=createAccessToken();
export const accessHeaders=authorization(accessToken);
export const authorizedDashboard=base=>dashboardURL(base,accessToken);
