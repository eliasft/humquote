# -*- coding: utf-8 -*-
"""
Spyder Editor

Script file for fetching ASX electricity futures.
"""


import streamlit as st
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import pandas as pd
from openpyxl import load_workbook

# Function to save dataframe to an Excel file
def save_to_excel(df, filename):
    # Extract the year from the quote date for the sheet name
    sheet_name = str(df['quote_date'].iloc[0].year)

    # Check if the Excel file already exists
    try:
        # Attempt to load the workbook
        book = load_workbook(filename)
        # If the sheet exists, append data, otherwise create a new sheet
        if sheet_name in book.sheetnames:
            with pd.ExcelWriter(filename, engine='openpyxl', mode='a') as writer:
                writer.book = book
                writer.sheets = {ws.title: ws for ws in book.worksheets}
                
                # Get the last row in the existing sheet
                # Assuming the sheet is not empty and has a header
                startrow = writer.sheets[sheet_name].max_row
                
                # Append data without adding the header
                df.to_excel(writer, sheet_name=sheet_name, startrow=startrow, index=False, header=False)
        else:
            with pd.ExcelWriter(filename, engine='openpyxl') as writer:
                writer.book = book
                df.to_excel(writer, sheet_name=sheet_name, index=False)
    except FileNotFoundError:
        # If the workbook does not exist, create it
        with pd.ExcelWriter(filename, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name=sheet_name, index=False)

# The imports and save_to_excel function remain unchanged

# Streamlit app
def main():
    # Streamlit interface
    st.title('Futures Prices Scraper')
    url = st.text_input('Enter the URL', 'https://www.asxenergy.com.au')
    filename = st.text_input('Enter the filename', 'futures_prices_database.xlsx')
    
    if st.button('Fetch and Save Data'):
        try:
            response = requests.get(url)
            if response.status_code == 200:
                # Use BeautifulSoup to parse the HTML content
                soup = BeautifulSoup(response.content, 'html.parser')
                
                # Find the date of the quotes
                date_tag = soup.find('h3', string=lambda t: t and 'Cal Base Future Prices' in t)
                if date_tag:
                    date_str = date_tag.text.replace('Cal Base Future Prices ', '')
                    quote_date = datetime.strptime(date_str, '%a %d %b %Y').date()
                else:
                    quote_date = datetime.now().date()
                
                # Find the futures prices table by its unique attributes or structure
                prices_table = soup.find('div', class_='dataset')
                
                if prices_table:
                    rows = prices_table.find_all('tr')
                    data = []
                    for row in rows[1:]:
                        cells = row.find_all('td')
                        year_of_instrument = ''.join(filter(str.isdigit, cells[0].text.strip()))
                        row_data = [quote_date, int(year_of_instrument)] + [cell.text.strip() for cell in cells[1:]]
                        data.append(row_data)
                    
                    headers = ['quote_date', 'instrument_year', 'NSW', 'VIC', 'QLD', 'SA']
                    df = pd.DataFrame(data, columns=headers)
                    
                    for col in df.columns[2:]:
                        df[col] = pd.to_numeric(df[col], errors='coerce')
                    
                    # Display the DataFrame in the Streamlit app
                    st.dataframe(df)

                    # Call the function to save the DataFrame to an Excel file
                    save_to_excel(df, filename)

                    st.success('Data fetched and saved successfully.')
                else:
                    st.error("The futures prices table was not found.")
            else:
                st.error(f'Failed to retrieve the page. Status code: {response.status_code}')
        except Exception as e:
            st.error(f'An error occurred: {e}')

# Run the Streamlit app
if __name__ == "__main__":
    main()
