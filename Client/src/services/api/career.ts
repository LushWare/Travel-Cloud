import { z } from 'zod';
import httpClient from '../http/client';
import { parseEnvelope } from '../http/envelope';
import { Vacancy, CareerApplicationRequest } from '@travel-crm/contracts';

interface VacancyFilters {
  status?: string;
}

type ApplicationPayload = z.infer<typeof CareerApplicationRequest>;

const careerApi = {
  getActiveVacancies: async (filters: VacancyFilters = {}) => {
    const params: VacancyFilters = {};
    if (filters.status) params.status = filters.status;
    const response = await httpClient.get('/vacancies', { params });
    return parseEnvelope(z.array(Vacancy), response.data, 'GET /vacancies').data;
  },

  submitApplication: async (applicationData: ApplicationPayload) => {
    const body = CareerApplicationRequest.parse(applicationData);
    const response = await httpClient.post('/careers/apply', body);
    return response.data;
  },
};

export const fetchActiveVacancies = async () => careerApi.getActiveVacancies({ status: 'active' });

export const submitCareerApplication = async (applicationData: ApplicationPayload) =>
  careerApi.submitApplication(applicationData);

export default careerApi;
